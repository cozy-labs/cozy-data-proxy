/* @flow weak */

import clone from 'lodash.clone'
import isEqual from 'lodash.isequal'
import path from 'path'
import pick from 'lodash.pick'

import Local from './local'
import logger from './logger'
import { extractRevNumber } from './metadata'
import Pouch from './pouch'
import Remote from './remote'

const log = logger({
  prefix: 'Merge         ',
  date: true
})

// When the local filesystem or the remote cozy detects a change, it calls this
// class to inform it (via Prep). This class will check how to operate this
// change against the data in pouchdb and then will update pouchdb. It avoids a
// lot of bogus data in pouchdb, like file created in the folder that doesn't
// exist.
//
// The documents in PouchDB have similar informations of those in CouchDB, but
// are not structured in the same way. In particular, the _id are uuid in CouchDB
// and the path to the file/folder (in a normalized form) in PouchDB.
//
// Conflicts can happen when we try to write one document for a path when
// another document already exists for the same path. We don't try to be smart
// and the rename one the two documents with a -conflict suffix. And even that
// isn't simple to implement. When the document is renamed, it fires some events
// that are not in the normal flow (rename instead of add, bogus delete) and we
// need to redirect them.
class Merge {
  pouch: Pouch
  local: Local
  remote: Remote

  constructor (pouch) {
    this.pouch = pouch
    // $FlowFixMe
    this.local = this.remote = null
  }

  /* Helpers */

  // Return true if the two dates are the same, +/- 3 seconds
  sameDate (one, two) {
    one = +new Date(one)
    two = +new Date(two)
    return Math.abs(two - one) < 3000
  }

  // Return true if the metadata of the two folders are the same
  // The creationDate of the two folders are not compared, because the local
  // filesystem can't give us a relevant information for that.
  // For lastModification, we accept up to 3s of differences because we can't
  // rely on file systems to be precise to the millisecond.
  sameFolder (one, two) {
    if (!this.sameDate(one.lastModification, two.lastModification)) { return false }
    let fields = ['_id', 'docType', 'remote', 'tags']
    one = pick(one, fields)
    two = pick(two, fields)
    const same = isEqual(one, two)
    if (!same) log.diff(one, two)
    return same
  }

  // Return true if the metadata of the two files are the same
  // The creationDate of the two files are not compared, because the local
  // filesystem can't give us a relevant information for that.
  // For lastModification, we accept up to 3s of differences because we can't
  // rely on file systems to be precise to the millisecond.
  sameFile (one, two) {
    if (!this.sameDate(one.lastModification, two.lastModification)) { return false }
    let fields = ['_id', 'docType', 'checksum', 'remote',
      'tags', 'size', 'class', 'mime']
    one = {...pick(one, fields), executable: !!one.executable}
    two = {...pick(two, fields), executable: !!two.executable}
    const same = isEqual(one, two)
    if (!same) log.diff(one, two)
    return same
  }

  // Return true if the two files have the same binary content
  sameBinary (one, two) {
    if ((one.docType !== 'file') || (two.docType !== 'file')) {
      return false
    } else if ((one.checksum != null) && (one.checksum === two.checksum)) {
      return true
    } else if ((one.remote != null) && (two.remote != null)) {
      let oneId = one.remote._id
      let twoId = two.remote._id
      return (oneId != null) && (oneId === twoId)
    } else {
      return false
    }
  }

  // Be sure that the tree structure for the given path exists
  ensureParentExist (side, doc, callback) {
    let parentId = path.dirname(doc._id)
    if (parentId === '.') {
      callback()
    } else {
      this.pouch.db.get(parentId, (_, folder) => {
        if (folder) {
          callback()
        } else {
          let parentDoc = {
            _id: parentId,
            path: path.dirname(doc.path),
            docType: 'folder',
            creationDate: new Date(),
            lastModification: new Date()
          }
          this.ensureParentExist(side, parentDoc, err => {
            if (err) {
              callback(err)
            } else {
              this.putFolder(side, parentDoc, callback)
            }
          })
        }
      })
    }
  }

  // Mark the next rev for this side
  //
  // To track which side has made which modification, a revision number is
  // associated to each side. When a side make a modification, we extract the
  // revision from the previous state, increment it by one to have the next
  // revision and associate this number to the side that makes the
  // modification.
  markSide (side, doc, prev) {
    let rev = 0
    if (prev) { rev = extractRevNumber(prev) }
    if (doc.sides == null) {
      const was = prev && prev.sides
      doc.sides = clone(was || {})
    }
    doc.sides[side] = ++rev
    return doc
  }

  // Resolve a conflict by renaming a file/folder
  // A suffix composed of -conflict- and the date is added to the path.
  resolveConflict (side, doc, callback) {
    let dst = clone(doc)
    let date = new Date().toISOString()
    let ext = path.extname(doc.path)
    let dir = path.dirname(doc.path)
    let base = path.basename(doc.path, ext)
    dst.path = `${path.join(dir, base)}-conflict-${date}${ext}`
    // $FlowFixMe
    this[side].resolveConflict(dst, doc, err => callback(err, dst))
  }

  /* Actions */

  // Add a file, if it doesn't already exist,
  // and create the tree structure if needed
  addFile (side, doc, callback) {
    this.pouch.db.get(doc._id, (err, file) => {
      if (err && (err.status !== 404)) { log.warn(err) }
      this.markSide(side, doc, file)
      let hasSameBinary = false
      if (file) {
        hasSameBinary = this.sameBinary(file, doc)
        // Photos uploaded by cozy-mobile have no checksum
        // but we should preserve metadata like tags
        if (!hasSameBinary) { hasSameBinary = file.remote && !file.checksum }
      }
      if (file && file.docType === 'folder') {
        this.resolveConflict(side, doc, callback)
      } else if (hasSameBinary) {
        doc._rev = file._rev
        if (doc.size == null) { doc.size = file.size }
        if (doc.class == null) { doc.class = file.class }
        if (doc.mime == null) { doc.mime = file.mime }
        if (doc.tags == null) { doc.tags = file.tags || [] }
        if (doc.remote == null) { doc.remote = file.remote }
        if (this.sameFile(file, doc)) {
          callback(null)
        } else {
          this.pouch.db.put(doc, callback)
        }
      } else if (file && file.checksum) {
        if ((side === 'local') && (file.sides.local != null)) {
          this.resolveInitialAdd(side, doc, file, callback)
        } else {
          this.resolveConflict(side, doc, callback)
        }
      } else {
        if (file) { doc._rev = file._rev }
        if (doc.tags == null) { doc.tags = [] }
        this.ensureParentExist(side, doc, () => {
          this.pouch.db.put(doc, callback)
        })
      }
    })
  }

  // When a file is modified when cozy-desktop is not running,
  // it is detected as a new file when cozy-desktop is started.
  resolveInitialAdd (side, doc, file, callback) {
    if (!file.sides.remote) {
      // The file was updated on local before being pushed to remote
      this.updateFile(side, doc, callback)
    } else if (file.sides.remote === file.sides.local) {
      // The file was updated on local after being synched to remote
      this.updateFile(side, doc, callback)
    } else {
      // The file was updated on remote and maybe in local too
      let shortRev = file.sides.local
      this.pouch.getPreviousRev(doc._id, shortRev, (err, prev) => {
        if (err || (prev.checksum !== doc.checksum)) {
          // It's safer to handle it as a conflict
          if (doc.remote == null) { doc.remote = file.remote }
          this.resolveConflict('remote', doc, callback)
        } else {
          // The file was only updated on remote
          callback(null)
        }
      })
    }
  }

  // Update a file, when its metadata or its content has changed
  updateFile (side, doc, callback) {
    this.pouch.db.get(doc._id, (err, file) => {
      if (err && (err.status !== 404)) { log.warn(err) }
      this.markSide(side, doc, file)
      if (file && file.docType === 'folder') {
        callback(new Error("Can't resolve this conflict!"))
      } else if (file) {
        doc._rev = file._rev
        if (doc.tags == null) { doc.tags = file.tags || [] }
        if (doc.remote == null) { doc.remote = file.remote }
        // Preserve the creation date even if the file system lost it!
        doc.creationDate = file.creationDate
        if (this.sameBinary(file, doc)) {
          if (doc.size == null) { doc.size = file.size }
          if (doc.class == null) { doc.class = file.class }
          if (doc.mime == null) { doc.mime = file.mime }
        }
        if (this.sameFile(file, doc)) {
          log.debug(`${doc.path}: already up to date`)
          callback(null)
        } else {
          this.pouch.db.put(doc, callback)
        }
      } else {
        if (doc.tags == null) { doc.tags = [] }
        if (doc.creationDate == null) { doc.creationDate = new Date() }
        this.ensureParentExist(side, doc, () => {
          this.pouch.db.put(doc, callback)
        })
      }
    })
  }

  // Create or update a folder
  putFolder (side, doc, callback) {
    this.pouch.db.get(doc._id, (err, folder) => {
      if (err && (err.status !== 404)) { log.warn(err) }
      this.markSide(side, doc, folder)
      if (folder && folder.docType === 'file') {
        this.resolveConflict(side, doc, callback)
      } else if (folder) {
        doc._rev = folder._rev
        if (doc.tags == null) { doc.tags = folder.tags || [] }
        if (doc.creationDate == null) { doc.creationDate = folder.creationDate }
        if (doc.remote == null) { doc.remote = folder.remote }
        if (this.sameFolder(folder, doc)) {
          log.debug(`${doc.path}: already up to date`)
          callback(null)
        } else {
          this.pouch.db.put(doc, callback)
        }
      } else {
        if (doc.tags == null) { doc.tags = [] }
        if (doc.creationDate == null) { doc.creationDate = new Date() }
        this.ensureParentExist(side, doc, () => {
          this.pouch.db.put(doc, callback)
        })
      }
    })
  }

  // Rename or move a file
  moveFile (side, doc, was, callback) {
    if (was.sides && was.sides[side]) {
      this.pouch.db.get(doc._id, (err, file) => {
        if (err && (err.status !== 404)) { log.warn(err) }
        this.markSide(side, doc, file)
        this.markSide(side, was, was)
        if (doc.creationDate == null) { doc.creationDate = was.creationDate }
        if (doc.size == null) { doc.size = was.size }
        if (doc.class == null) { doc.class = was.class }
        if (doc.mime == null) { doc.mime = was.mime }
        if (doc.tags == null) { doc.tags = was.tags || [] }
        was.moveTo = doc._id
        was._deleted = true
        delete was.errors
        if (file && this.sameFile(file, doc)) {
          callback(null)
        } else if (file) {
          this.resolveConflict(side, doc, (_, dst) => {
            was.moveTo = dst._id
            dst.sides = {}
            dst.sides[side] = 1
            this.pouch.db.bulkDocs([was, dst], callback)
          })
        } else {
          this.ensureParentExist(side, doc, () => {
            this.pouch.db.bulkDocs([was, doc], callback)
          })
        }
      })
    } else { // It can happen after a conflict
      this.addFile(side, doc, callback)
    }
  }

  // Rename or move a folder (and every file and folder inside it)
  moveFolder (side, doc, was, callback) {
    if (was.sides && was.sides[side]) {
      this.pouch.db.get(doc._id, (err, folder) => {
        if (err && (err.status !== 404)) { log.warn(err) }
        this.markSide(side, doc, folder)
        this.markSide(side, was, was)
        if (doc.creationDate == null) { doc.creationDate = was.creationDate }
        if (doc.tags == null) { doc.tags = was.tags || [] }
        if (folder) {
          this.resolveConflict(side, doc, (_, dst) => {
            dst.sides = {}
            dst.sides[side] = 1
            this.moveFolderRecursively(dst, was, callback)
          })
        } else {
          this.ensureParentExist(side, doc, () => {
            this.moveFolderRecursively(doc, was, callback)
          })
        }
      })
    } else { // It can happen after a conflict
      this.putFolder(side, doc, callback)
    }
  }

  // Move a folder and all the things inside it
  moveFolderRecursively (folder, was, callback) {
    this.pouch.byRecursivePath(was._id, (err, docs) => {
      if (err) {
        callback(err)
      } else {
        was._deleted = true
        was.moveTo = folder._id
        let bulk = [was, folder]
        for (let doc of Array.from(docs)) {
          let src = clone(doc)
          src._deleted = true
          // moveTo is used for comparison. It's safer to take _id
          // than path for this case, as explained in doc/design.md
          src.moveTo = doc._id.replace(was._id, folder._id)
          delete src.errors
          bulk.push(src)
          let dst = clone(doc)
          dst._id = src.moveTo
          delete dst._rev
          bulk.push(dst)
          delete dst.errors
        }
        this.pouch.db.bulkDocs(bulk, callback)
      }
    })
  }

  // Remove a file from PouchDB
  //
  // As the watchers often detect the deletion of a folder before the deletion
  // of the files inside it, deleteFile can be called for a file that has
  // already been removed. This is not considerated as an error.
  deleteFile (side, doc, callback) {
    this.pouch.db.get(doc._id, (err, file) => {
      if (err && err.status === 404) {
        callback(null)
      } else if (err) {
        callback(err)
      } else if (file.sides && file.sides[side]) {
        this.markSide(side, file, file)
        file._deleted = true
        delete file.errors
        this.pouch.db.put(file, callback)
      } else { // It can happen after a conflict
        callback(null)
      }
    })
  }

  // Remove a folder
  //
  // When a folder is removed in PouchDB, we also remove the files and folders
  // inside it to ensure consistency. The watchers often detects the deletion
  // of a nested folder after the deletion of its parent. In this case, the
  // call to deleteFolder for the child is considered as successful, even if
  // the folder is missing in pouchdb (error 404).
  deleteFolder (side, doc, callback) {
    this.pouch.db.get(doc._id, (err, folder) => {
      if (err && err.status === 404) {
        callback(null)
      } else if (err) {
        callback(err)
      } else if (folder.sides && folder.sides[side]) {
        this.deleteFolderRecursively(side, folder, callback)
      } else { // It can happen after a conflict
        callback(null)
      }
    })
  }

  // Remove a folder and every thing inside it
  deleteFolderRecursively (side, folder, callback) {
    this.pouch.byRecursivePath(folder._id, (err, docs) => {
      if (err) {
        callback(err)
      } else {
        // In the changes feed, nested subfolder must be deleted
        // before their parents, hence the reverse order.
        docs = docs.reverse()
        docs.push(folder)
        for (let doc of Array.from(docs)) {
          this.markSide(side, doc, doc)
          doc._deleted = true
          delete doc.errors
        }
        this.pouch.db.bulkDocs(docs, callback)
      }
    })
  }
}

export default Merge
