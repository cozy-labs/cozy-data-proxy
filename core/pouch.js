/* @flow weak */

const autoBind = require('auto-bind')
const Promise = require('bluebird')
const PouchDB = require('pouchdb')
const async = require('async')
const fs = require('fs-extra')
const { isEqual } = require('lodash')
const path = require('path')

const logger = require('./logger')
const metadata = require('./metadata')

/*::
import type Config from './config'
import type { Metadata } from './metadata'
import type { Callback } from './utils/func'
*/

const log = logger({
  component: 'Pouch'
})

// Pouchdb is used to store all the metadata about files and folders.
// These metadata can come from the local filesystem or the remote cozy instance.
//
// Best practices from:
// http://pouchdb.com/2014/06/17/12-pro-tips-for-better-code-with-pouchdb.html
// http://docs.ehealthafrica.org/couchdb-best-practices/
//
// For naming conventions, we kept those used on cozy and its couchdb. And
// views name are in camelcase (byChecksum, not by-checksum).
class Pouch {
  /*::
  config: Config
  db: PouchDB
  updater: any
  _lock: {id: number, promise: Promise}
  nextLockId: number
  */

  constructor (config) {
    this.config = config
    this.nextLockId = 0
    this._lock = {id: this.nextLockId++, promise: Promise.resolve(null)}
    this.db = new PouchDB(this.config.dbPath)
    this.db.setMaxListeners(100)
    this.db.on('error', err => log.warn(err))
    this.updater = async.queue((task, callback) => {
      return this.db.get(task._id, (err, doc) => {
        if (err && err.status === 404) {
          return this.db.put(task, callback)
        } else if (err) {
          return callback(err)
        } else {
          task._rev = doc._rev
          return this.db.put(task, callback)
        }
      })
    })

    autoBind(this)
    Promise.promisifyAll(this)
  }

  /*::
  byPathAsync: (string) => Promise<Metadata>
  byChecksumAsync: (string) => Promise<Metadata[]>
  byRecursivePathAsync: (string) => Promise<*>
  byRemoteIdAsync: (id: string) => Promise<*>
  byRemoteIdMaybeAsync: (id: string) => Promise<*>
  addAllViewsAsync: () => Promise<*>
  getPreviousRevAsync: (id: string, shortRev: ?number) => Promise<Metadata>
  getLocalSeqAsync: () => Promise<number>
  setLocalSeqAsync: (number) => Promise<*>
  getRemoteSeqAsync: () => string
  setRemoteSeqAsync: (seq: string) => Promise<*>
  treeAsync: () => Promise<Array<string>>
  */

  // Create database and recreate all filters
  resetDatabase (callback) {
    this.db.destroy(() => {
      fs.ensureDirSync(this.config.dbPath)
      this.db = new PouchDB(this.config.dbPath)
      this.db.setMaxListeners(100)
      this.db.on('error', err => log.warn(err))
      return this.addAllViews(callback)
    })
  }

  lock (component /*: * */) /*: Promise<Function> */ {
    const id = this.nextLockId++
    if (typeof component !== 'string') component = component.constructor.name
    log.trace({component, lock: {id, state: 'requested'}})
    let pCurrent = this._lock.promise
    let _resolve
    let pReleased = new Promise((resolve) => { _resolve = resolve })
    this._lock = {id, promise: pCurrent.then(() => pReleased)}
    return pCurrent.then(() => {
      log.trace({component, lock: {id, state: 'acquired'}})
      return () => {
        log.trace({component, lock: {id, state: 'released'}})
        _resolve()
      }
    })
  }

  /* Mini ODM */

  put (doc /*: Metadata */, callback /*: ?Callback */) {
    metadata.invariants(doc)
    const {local, remote} = doc.sides
    log.debug({path: doc.path, local, remote, _deleted: doc._deleted, doc}, 'Saving metadata...')
    return this.db.put(doc).asCallback(callback)
  }

  // WARNING: bulkDocs is not a transaction, some updates can be applied while
  // others do not.
  // Make sure lock is acquired before using it to avoid conflict.
  async bulkDocs (docs /*: Metadata[] */) {
    for (const doc of docs) {
      metadata.invariants(doc)
      const {path} = doc
      const {local, remote} = doc.sides || {}
      log.debug({path, local, remote, _deleted: doc._deleted, doc}, 'Saving bulk metadata...')
    }
    const results = await this.db.bulkDocs(docs)
    for (let [idx, result] of results.entries()) {
      if (result.error) {
        const err = new Error(result.message)
        // $FlowFixMe
        err.status = result.status
        err.name = result.name
        log.error({doc: docs[idx]}, err)
        throw err
      }
    }
    return results
  }

  // Run a query and get all the results
  getAll (query, params, callback) {
    if (typeof params === 'function') {
      callback = params
      params = {include_docs: true}
    }
    // XXX Pouchdb does sometimes send us undefined values in docs.
    // It's rare and we didn't find a way to extract a proper test case.
    // So, we keep a workaround and hope that this bug will be fixed.
    this.db.query(query, params, function (err, res) {
      if (err) {
        return callback(err)
      } else {
        let docs = (Array.from(res.rows).filter((row) => (row.doc != null)).map((row) => row.doc))
        return callback(null, docs)
      }
    })
  }

  // Get current revision for multiple docs by ids as an index id => rev
  // non-existing documents will not be added to the index
  async getAllRevsAsync (ids) {
    const result = await this.db.allDocs({keys: ids})
    const index = {}
    for (let row of result.rows) if (row.value) index[row.key] = row.value.rev
    return index
  }

  async byIdMaybeAsync (id /*: string */) /*: Promise<?Metadata> */ {
    let doc
    try {
      doc = await this.db.get(id)
    } catch (err) {
      if (err.status !== 404) throw err
    }
    return doc
  }

  // Return all the files with this checksum
  byChecksum (checksum, callback) {
    let params = {
      key: checksum,
      include_docs: true
    }
    return this.getAll('byChecksum', params, callback)
  }

  // Return all the files and folders in this path, only at first level
  byPath (path, callback) {
    let params = {
      key: path,
      include_docs: true
    }
    return this.getAll('byPath', params, callback)
  }

  // Return all the files and folders in this path, even in subfolders
  byRecursivePath (basePath, callback) {
    let params
    if (basePath === '') {
      params = {include_docs: true}
    } else {
      params = {
        startkey: `${basePath}`,
        endkey: `${basePath}${path.sep}\ufff0`,
        include_docs: true
      }
    }
    return this.getAll('byPath', params, callback)
  }

  // Return the file/folder with this remote id
  byRemoteId (id, callback) {
    let params = {
      key: id,
      include_docs: true
    }
    this.db.query('byRemoteId', params, function (err, res) {
      if (err) {
        return callback(err)
      } else if (res.rows.length === 0) {
        // eslint-disable-next-line standard/no-callback-literal
        return callback({status: 404, message: 'missing'})
      } else {
        return callback(null, res.rows[0].doc)
      }
    })
  }

  byRemoteIdMaybe (id, callback) {
    this.byRemoteId(id, (err, was) => {
      if (err && (err.status !== 404)) {
        callback(err)
      } else {
        callback(null, was)
      }
    })
  }

  async allByRemoteIds (remoteIds /*: * */) /* Promise<Metadata[]> */ {
    const params = {keys: Array.from(remoteIds), include_docs: true}
    const results = await this.db.query('byRemoteId', params)
    return results.rows.map(row => row.doc)
  }

  /* Views */

  // Create all required views in the database
  addAllViews (callback) {
    return async.series([
      this.addByPathView,
      this.addByChecksumView,
      this.addByRemoteIdView
    ], err => callback(err))
  }

  // Create a view to list files and folders inside a path
  // The path for a file/folder in root will be '',
  // not '.' as with node's path.dirname
  addByPathView (callback) {
    const sep = JSON.stringify(path.sep)
    let query = `
      function (doc) {
        if ('docType' in doc) {
          let parts = doc._id.split(${sep})
          parts.pop()
          return emit(parts.join(${sep}), {_id: doc._id})
        }
      }
    `
    return this.createDesignDoc('byPath', query, callback)
  }

  // Create a view to find files by their checksum
  addByChecksumView (callback) {
    /* !pragma no-coverage-next */
    /* istanbul ignore next */
    let query =
      function (doc) {
        if ('md5sum' in doc) {
          // $FlowFixMe
          return emit(doc.md5sum) // eslint-disable-line no-undef
        }
      }.toString()
    return this.createDesignDoc('byChecksum', query, callback)
  }

  // Create a view to find file/folder by their _id on a remote cozy
  addByRemoteIdView (callback) {
    /* !pragma no-coverage-next */
    /* istanbul ignore next */
    let query =
      function (doc) {
        if ('remote' in doc) {
          // $FlowFixMe
          return emit(doc.remote._id) // eslint-disable-line no-undef
        }
      }.toString()
    return this.createDesignDoc('byRemoteId', query, callback)
  }

  // Create or update given design doc
  createDesignDoc (name, query, callback) {
    let doc = {
      _id: `_design/${name}`,
      views: {}
    }
    doc.views[name] = {map: query}
    this.db.get(doc._id, (_, designDoc) => {
      if (designDoc != null) {
        // $FlowFixMe
        doc._rev = designDoc._rev
        if (isEqual(doc, designDoc)) { return callback() }
      }
      return this.db.put(doc, function (err) {
        if (!err) { log.debug(`Design document created: ${name}`) }
        return callback(err)
      })
    })
  }

  // Remove a design document for a given docType
  removeDesignDoc (docType, callback) {
    let id = `_design/${docType}`
    this.db.get(id, (err, designDoc) => {
      if (designDoc != null) {
        return this.db.remove(id, designDoc._rev, callback)
      } else {
        return callback(err)
      }
    })
  }

  /* Helpers */

  // Retrieve a previous doc revision from its id
  getPreviousRev (id, shortRev, callback) {
    let options = {
      revs: true,
      revs_info: true,
      open_revs: 'all'
    }
    this.db.get(id, options, (err, infos) => {
      if (err) {
        return callback(err)
      } else {
        let { ids } = infos[0].ok._revisions
        let { start } = infos[0].ok._revisions
        let revId = ids[start - shortRev]
        let rev = `${shortRev}-${revId}`
        return this.db.get(id, {rev}, function (err, doc) {
          if (err) { log.debug(infos[0].doc) }
          return callback(err, doc)
        })
      }
    })
  }

  /* Sequence numbers */

  // Get last local replication sequence,
  // ie the last change from pouchdb that have been applied
  getLocalSeq (callback) {
    this.db.get('_local/localSeq', function (err, doc) {
      if (err && err.status === 404) {
        callback(null, 0)
      } else {
        callback(err, doc && doc.seq)
      }
    })
  }

  // Set last local replication sequence
  // It is saved in PouchDB as a local document
  // See http://pouchdb.com/guides/local-documents.html
  setLocalSeq (seq, callback) {
    let task = {
      _id: '_local/localSeq',
      seq
    }
    return this.updater.push(task, callback)
  }

  // Get last remote replication sequence,
  // ie the last change from couchdb that have been saved in pouch
  getRemoteSeq (callback) {
    this.db.get('_local/remoteSeq', function (err, doc) {
      if (err && err.status === 404) {
        callback(null, 0)
      } else {
        callback(err, doc && doc.seq)
      }
    })
  }

  // Set last remote replication sequence
  // It is saved in PouchDB as a local document
  // See http://pouchdb.com/guides/local-documents.html
  setRemoteSeq (seq, callback) {
    let task = {
      _id: '_local/remoteSeq',
      seq
    }
    return this.updater.push(task, callback)
  }

  tree (callback) {
    this.db.allDocs((err, result) => {
      if (err) return callback(err)
      callback(null, result.rows.map(row => row.id).sort())
    })
  }
}

module.exports = Pouch
