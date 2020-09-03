/**
 * @module core/pouch
 * @flow weak
 */

const autoBind = require('auto-bind')
const Promise = require('bluebird')
const PouchDB = require('pouchdb')
const async = require('async')
const fse = require('fs-extra')
const _ = require('lodash')
const { isEqual } = _
const path = require('path')

const metadata = require('../metadata')
const logger = require('../utils/logger')
const { PouchError } = require('./error')
const {
  MIGRATION_RESULT_FAILED,
  MigrationFailedError,
  migrate,
  migrationLog
} = require('./migrations')

/*::
import type { Config } from '../config'
import type { Metadata } from '../metadata'
import type { Callback } from '../utils/func'
import type { Migration } from './migrations'
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

  constructor(config) {
    this.config = config
    this.nextLockId = 0
    this._lock = { id: this.nextLockId++, promise: Promise.resolve(null) }
    this.db = new PouchDB(this.config.dbPath)
    this.db.setMaxListeners(100)
    this.db.on('error', err => log.warn(err))
    this.updater = async.queue(async task => {
      const taskDoc = await this.byIdMaybe(task._id)
      if (taskDoc) return this.db.put({ ...task, _rev: taskDoc._rev })
      else return this.db.put(task)
    })

    autoBind(this)
  }

  // Create database and recreate all filters
  async resetDatabase() {
    await this.db.destroy()
    await fse.ensureDir(this.config.dbPath)
    this.db = new PouchDB(this.config.dbPath)
    this.db.setMaxListeners(100)
    this.db.on('error', err => log.warn(err))
    return this.addAllViews()
  }

  lock(component /*: * */) /*: Promise<Function> */ {
    const id = this.nextLockId++
    if (typeof component !== 'string') component = component.constructor.name
    log.trace({ component, lock: { id, state: 'requested' } }, 'lock requested')
    const pCurrent = this._lock.promise
    let _resolve
    const pReleased = new Promise(resolve => {
      _resolve = resolve
    })
    this._lock = { id, promise: pCurrent.then(() => pReleased) }
    return pCurrent.then(() => {
      log.trace({ component, lock: { id, state: 'acquired' } }, 'lock acquired')
      return () => {
        log.trace(
          { component, lock: { id, state: 'released' } },
          'lock released'
        )
        _resolve()
      }
    })
  }

  async runMigrations(migrations /*: Migration[] */) {
    log.info('Running migrations...')
    for (const migration of migrations) {
      let result

      // First attempt
      result = await migrate(migration, this)
      log.info(migrationLog(migration, result))

      if (result.type === MIGRATION_RESULT_FAILED) {
        // Retry in case of failure
        result = await migrate(migration, this)
      }

      if (result.type === MIGRATION_RESULT_FAILED) {
        // Error in case of second failure
        const err = new MigrationFailedError(migration, result.errors)
        log.fatal({ err }, migrationLog(migration, result))
        throw err
      } else {
        log.info(migrationLog(migration, result))
      }
    }
    log.info('Migrations done.')
  }

  /* Mini ODM */

  async allDocs() /*: Promise<Metadata[]> */ {
    const results = await this.db.allDocs({ include_docs: true })
    return Array.from(results.rows)
      .filter(row => !row.key.startsWith('_'))
      .map(row => row.doc)
  }

  async initialScanDocs() /*: Promise<Metadata[]> */ {
    const results = await this.db.allDocs({ include_docs: true })
    return Array.from(results.rows)
      .filter(
        row =>
          !row.key.startsWith('_') && // Filter out design docs
          !row.doc.deleted && // Filter out docs already marked for deletion
          row.doc.sides &&
          row.doc.sides.local // Keep only docs that have existed locally
      )
      .map(row => row.doc)
  }

  put(doc /*: Metadata */) /*: Promise<void> */ {
    metadata.invariants(doc)
    const { local, remote } = doc.sides
    log.debug(
      { path: doc.path, local, remote, _deleted: doc._deleted, doc },
      'Saving metadata...'
    )
    return this.db.put(doc)
  }

  remove(doc /*: Metadata */) /*: Promise<*> */ {
    return this.put(_.defaults({ _deleted: true }, doc))
  }

  // WARNING: bulkDocs is not a transaction, some updates can be applied while
  // others do not.
  // Make sure lock is acquired before using it to avoid conflict.
  async bulkDocs(docs /*: Metadata[] */) {
    for (const doc of docs) {
      metadata.invariants(doc)
      const { path } = doc
      const { local, remote } = doc.sides || {}
      log.debug(
        { path, local, remote, _deleted: doc._deleted, doc },
        'Saving bulk metadata...'
      )
    }
    const results = await this.db.bulkDocs(docs)
    for (let [idx, result] of results.entries()) {
      if (result.error) {
        const err = new PouchError(result)
        const doc = docs[idx]
        log.error({ path: doc.path, doc }, err)
        throw err
      }
    }
    return results
  }

  // Run a query and get all the results
  async getAll(query, params = { include_docs: true }) {
    const { rows } = await this.db.query(query, params)

    return rows.filter(row => row.doc != null).map(row => row.doc)
  }

  // Get current revision for multiple docs by ids as an index id => rev
  // non-existing documents will not be added to the index
  async getAllRevs(ids) {
    const result = await this.db.allDocs({ keys: ids })
    const index = {}
    for (let row of result.rows) if (row.value) index[row.key] = row.value.rev
    return index
  }

  async byIdMaybe(id /*: string */) /*: Promise<?Metadata> */ {
    try {
      return await this.db.get(id)
    } catch (err) {
      if (err.status !== 404) throw err
    }
  }

  // Return all the files with this checksum
  byChecksum(checksum) {
    let params = {
      key: checksum,
      include_docs: true
    }
    return this.getAll('byChecksum', params)
  }

  // Return all the files and folders in this path, only at first level
  byPath(basePath) {
    const params = {
      key: basePath === '' ? basePath : basePath + path.sep,
      include_docs: true
    }
    return this.getAll('byPath', params)
  }

  // Return all the files and folders in this path, even in subfolders
  byRecursivePath(basePath) {
    let params
    if (basePath === '') {
      params = { include_docs: true }
    } else {
      params = {
        startkey: `${basePath}${path.sep}`,
        endkey: `${basePath}${path.sep}\ufff0`,
        include_docs: true
      }
    }
    return this.getAll('byPath', params)
  }

  // Return the file/folder with this remote id
  async byRemoteId(id) {
    const params = {
      key: id,
      include_docs: true
    }
    const { rows } = await this.db.query('byRemoteId', params)
    if (rows.length === 0) {
      throw { status: 404, message: 'missing' }
    } else {
      return rows[0].doc
    }
  }

  async byRemoteIdMaybe(id) {
    try {
      return await this.byRemoteId(id)
    } catch (err) {
      if (err && err.status !== 404) {
        throw err
      }
    }
  }

  async allByRemoteIds(remoteIds /*: * */) /* Promise<Metadata[]> */ {
    const params = { keys: Array.from(remoteIds), include_docs: true }
    const results = await this.db.query('byRemoteId', params)
    return results.rows.map(row => row.doc)
  }

  /* Views */

  // Create all required views in the database
  addAllViews() {
    return new Promise((resolve, reject) => {
      async.series(
        [this.addByPathView, this.addByChecksumView, this.addByRemoteIdView],
        err => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  // Create a view to list files and folders inside a path
  // The path for a file/folder in root will be '',
  // not '.' as with node's path.dirname
  async addByPathView() {
    const sep = JSON.stringify(path.sep)
    const query = `function(doc) {
      if ('docType' in doc) {
        const parts = doc._id.split(${sep})
        parts.pop()
        const basePath = parts.concat('').join(${sep})
        return emit(basePath, { _id: doc._id })
      }
    }`
    await this.createDesignDoc('byPath', query)
  }

  // Create a view to find files by their checksum
  async addByChecksumView() {
    /* !pragma no-coverage-next */
    /* istanbul ignore next */
    const query = function(doc) {
      if ('md5sum' in doc) {
        // $FlowFixMe
        return emit(doc.md5sum) // eslint-disable-line no-undef
      }
    }.toString()
    await this.createDesignDoc('byChecksum', query)
  }

  // Create a view to find file/folder by their _id on a remote cozy
  async addByRemoteIdView() {
    /* !pragma no-coverage-next */
    /* istanbul ignore next */
    const query = function(doc) {
      if ('remote' in doc) {
        // $FlowFixMe
        return emit(doc.remote._id) // eslint-disable-line no-undef
      }
    }.toString()
    await this.createDesignDoc('byRemoteId', query)
  }

  // Create or update given design doc
  async createDesignDoc(name, query) {
    const doc = {
      _id: `_design/${name}`,
      _rev: null,
      views: {
        [name]: { map: query }
      }
    }
    const designDoc = await this.byIdMaybe(doc._id)
    if (designDoc) doc._rev = designDoc._rev
    if (isEqual(doc, designDoc)) {
      return
    } else {
      await this.db.put(doc)
      log.debug(`Design document created: ${name}`)
    }
  }

  // Remove a design document for a given docType
  async removeDesignDoc(docType) {
    const id = `_design/${docType}`
    const designDoc = await this.db.get(id)
    return this.db.remove(id, designDoc._rev)
  }

  /* Helpers */

  // Retrieve a previous doc revision from its id
  async getPreviousRev(id, revDiff) {
    const options = {
      revs: true,
      revs_info: true,
      open_revs: 'all'
    }
    const [{ ok, doc }] = await this.db.get(id, options)
    const { ids, start } = ok._revisions
    const shortRev = start - revDiff
    const revId = ids[revDiff]
    const rev = `${shortRev}-${revId}`

    try {
      return await this.db.get(id, { rev })
    } catch (err) {
      log.debug(
        { path: doc.path, rev, doc },
        'could fetch fetch previous revision'
      )
      throw err
    }
  }

  /* Sequence numbers */

  // Get last local replication sequence,
  // ie the last change from pouchdb that have been applied
  async getLocalSeq() {
    const doc = await this.byIdMaybe('_local/localSeq')
    if (doc) return doc.seq
    else return 0
  }

  // Set last local replication sequence
  // It is saved in PouchDB as a local document
  // See http://pouchdb.com/guides/local-documents.html
  setLocalSeq(seq) {
    const task = {
      _id: '_local/localSeq',
      seq
    }
    return new Promise((resolve, reject) => {
      this.updater.push(task, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // Get last remote replication sequence,
  // ie the last change from couchdb that have been saved in pouch
  async getRemoteSeq() {
    const doc = await this.byIdMaybe('_local/remoteSeq')
    if (doc) return doc.seq
    else return 0
  }

  // Set last remote replication sequence
  // It is saved in PouchDB as a local document
  // See http://pouchdb.com/guides/local-documents.html
  setRemoteSeq(seq) {
    const task = {
      _id: '_local/remoteSeq',
      seq
    }
    return new Promise((resolve, reject) => {
      this.updater.push(task, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async unsyncedDocIds() {
    const localSeq = await this.getLocalSeq()
    return new Promise((resolve, reject) => {
      this.db
        .changes({
          since: localSeq,
          filter: '_view',
          view: 'byPath'
        })
        .on('complete', ({ results }) => resolve(results.map(r => r.id)))
        .on('error', err => reject(err))
    })
  }

  // Touch existing documents with the given ids to make sure they appear in the
  // changesfeed.
  // Careful: this will change their _rev value!
  async touchDocs(ids /*: string[] */) {
    const results = await this.db.allDocs({ include_docs: true, keys: ids })
    return this.bulkDocs(
      Array.from(results.rows)
        .filter(row => row.doc)
        .map(row => row.doc)
    )
  }

  tree() {
    const { rows } = this.db.allDocs()
    return rows.map(row => row.id).sort()
  }
}

module.exports = { Pouch }
