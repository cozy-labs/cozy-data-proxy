/**
 * @module core/merge
 * @flow
 */

const autoBind = require('auto-bind')
const _ = require('lodash')
const path = require('path')

const IdConflict = require('./IdConflict')
const metadata = require('./metadata')
const move = require('./move')
const { otherSide } = require('./side')
const logger = require('./utils/logger')
const { isNote } = require('./utils/notes')

/*::
import type { IdConflictInfo } from './IdConflict'
import type { Local } from './local'
import type {
  Metadata,
  MetadataRemoteInfo,
  SavedMetadata,
  RemoteRevisionsByID,
} from './metadata'
import type { Pouch } from './pouch'
import type { Remote } from './remote'
import type { SideName } from './side'
*/

const log = logger({
  component: 'Merge'
})

/** Error occuring when parent of doc being merged is missing from Pouch.
 *
 * For now, this error only occurs when merging remote changes.
 *
 * In case the parent is missing, the made-up document would be inconsistent,
 * with `sides.remote` set but no `remote._id` nor `remote._rev`. Any
 * subsequent subsequent local change could fail because of those missing.
 *
 * Regarding local changes, one could wonder whether we should adopt the same
 * behavior: made-up documents will be missing an inode. Which could result in
 * subsequent moves not being detected correctly. But at least it should not
 * prevent subsequent remote changes from being synced since the inode is not
 * used in this case.
 *
 * This error is mostly caused by a bug, either in a previous Merge/Sync run
 * or related to some watcher events order.
 */
class MergeMissingParentError extends Error {
  /*::
  doc: Metadata
  */

  constructor(doc /*: Metadata */) {
    super('Cannot merge remote change: Missing parent metadata')
    this.name = 'MergeMissingParentError'
    this.doc = doc
  }
}

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
  /*::
  pouch: Pouch
  local: Local
  remote: Remote
  */

  constructor(pouch /*: Pouch */) {
    this.pouch = pouch
    // $FlowFixMe
    this.local = this.remote = null
    autoBind(this)
  }

  /* Helpers */

  // Be sure that the tree structure for the given path exists
  async ensureParentExistAsync(side /*: SideName */, doc /*: * */) {
    log.trace({ path: doc.path }, 'ensureParentExistAsync')
    let parentPath = path.dirname(doc.path)
    if (parentPath === '.') {
      return
    }

    // BUG on windows with incompatible names like "D:IR"
    if (path.dirname(parentPath) === parentPath) {
      return
    }

    try {
      const folder = await this.pouch.bySyncedPath(parentPath)
      if (folder && !folder.deleted) {
        return
      }
    } catch (err) {
      if (err.status !== 404) {
        log.warn(err)
      }
    }
    if (side === 'remote') {
      throw new MergeMissingParentError(doc)
    }

    let parentDoc = {
      _id: metadata.id(parentPath),
      path: parentPath,
      docType: 'folder',
      updated_at: new Date().toISOString()
    }

    try {
      await this.ensureParentExistAsync(side, parentDoc)
    } catch (err) {
      throw err
    }

    // $FlowFixMe parent doc is incomplete
    return this.putFolderAsync(side, parentDoc)
  }

  // Resolve a conflict by renaming a file/folder
  // A suffix composed of -conflict- and the date is added to the path.
  async resolveConflictAsync(
    side /*: SideName */,
    doc /*: Metadata */
  ) /*: Promise<Metadata> */ {
    const dst = metadata.createConflictingDoc(doc)
    log.warn({ path: dst.path, oldpath: doc.path }, 'Resolving conflict')
    try {
      // $FlowFixMe
      await this[side].moveAsync(dst, doc)
    } catch (err) {
      throw err
    }
    return dst
  }

  // Resolve Cozy Note conflict when its content is updated on the local
  // filesystem and would therefore break the actual Note.
  // We always rename the remote document since this method should only be
  // called in case of a local update and the local file could still be open in
  // the user's editor and renaming it could create issues (e.g. the editor does
  // not detect the renaming and we'd create a new conflict each time the open
  // file would be saved).
  async resolveNoteConflict(doc /*: Metadata */, was /*: ?SavedMetadata */) {
    // We move the existing Cozy Note to a conflicting path since we've
    // updated it locally.
    await this.resolveConflictAsync('remote', doc)

    if (was) {
      // If we are resolving a conflict as part of move, we have a second record
      // to account for, the move source, `was`.
      // We want to make sure the remote watcher won't detect the movement of the
      // remote note as such because the file on the local filesystem has already
      // been moved.
      // So we make sure the source document is erased from PouchDB. The remote
      // watcher will then detect the new, conflicting note, as a file creation.
      // TODO: change path instead of erasing document since we won't be writing
      // to the same _id anymore.
      metadata.markAsUnsyncable(was)
      await this.pouch.put(was)
    }

    if (doc.overwrite) {
      // If this conflict would still result in a document overwrite (i.e. it's
      // an update or an overwriting move), we need to erase the existing
      // PouchDB record for the overwritten note so we can create a new record
      // in its stead.
      // The note has been renamed on the remote Cozy and will be pulled back
      // with the next remote watcher cycle.
      const { overwrite } = doc
      // TODO: change path instead of erasing document since we won't be writing
      // to the same _id anymore.
      metadata.markAsUnsyncable(overwrite)
      await this.pouch.put(overwrite)
      // We're not overwriting a document anymore
      delete doc.overwrite
    }

    // We create it at the destination location as a normal local file
    metadata.markAsNew(doc)
    metadata.dissociateRemote(doc)
    metadata.removeNoteMetadata(doc)
    return this.addFileAsync('local', doc)
  }

  /* Actions */

  // Add a file, if it doesn't already exist,
  // and create the tree structure if needed
  async addFileAsync(side /*: SideName */, doc /*: Metadata */) {
    log.debug({ path: doc.path }, 'addFileAsync')
    const file /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)

    if (file) {
      if (file.deleted) {
        return this.updateFileAsync(side, doc)
      }

      const idConflict /*: ?IdConflictInfo */ = IdConflict.detect(
        { side, doc },
        file
      )
      if (idConflict) {
        log.warn({ idConflict }, IdConflict.description(idConflict))
        await this.resolveConflictAsync(side, doc)
        return
      }

      if (file.docType === 'folder') {
        return this.resolveConflictAsync(side, doc)
      }

      return this.updateFileAsync(side, doc)
    }

    metadata.markSide(side, doc)
    metadata.assignMaxDate(doc)
    await this.ensureParentExistAsync(side, doc)

    return this.pouch.put(doc)
  }

  // Update a file, when its metadata or its content has changed
  async updateFileAsync(side /*: SideName */, doc /*: Metadata */) {
    log.debug({ path: doc.path }, 'updateFileAsync')

    const file /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)
    if (!file) {
      metadata.markSide(side, doc)
      metadata.assignMaxDate(doc)
      await this.ensureParentExistAsync(side, doc)
      return this.pouch.put(doc)
    } else {
      if (file.docType === 'folder') {
        throw new Error("Can't resolve this conflict!")
      }

      if (
        side === 'local' &&
        file.local &&
        metadata.sameFile(file.local, doc.local)
      ) {
        log.debug({ path: doc.path, doc, file }, 'Same local binary')
        if (!metadata.sameLocal(file.local, doc.local)) {
          metadata.updateLocal(file, doc.local)
          const outdated = metadata.outOfDateSide(file)
          if (outdated) {
            // In case a change was merged but not applied, we want to make sure
            // Sync will compare the current record version with the correct
            // "previous" version (i.e. the one before the actual change was
            // merged and not the one before we merged the new local metadata).
            // Therefore, we mark the changed side once more to account for the
            // new record save.
            metadata.markSide(otherSide(outdated), file, file)
          }
          return this.pouch.put(file)
        } else {
          return
        }
      }

      if (file.deleted) {
        // If the existing record was marked for deletion, we only keep the
        // PouchDB attributes that will allow us to overwrite it.
        doc._id = file._id
        doc._rev = file._rev
      } else {
        // Otherwise we merge the relevant attributes
        doc = {
          ..._.cloneDeep(file),
          ...doc,
          // Tags come from the remote document and will always be empty in a new
          // local document.
          tags: doc.tags.length === 0 ? file.tags : doc.tags,
          // if file is updated on windows, it will never be executable so we keep
          // the existing value.
          executable:
            side === 'local' && process.platform === 'win32'
              ? file.executable
              : doc.executable
        }
      }

      if (!metadata.sameBinary(file, doc)) {
        if (!file.deleted && !metadata.isAtLeastUpToDate(side, file)) {
          if (side === 'local') {
            // We have a merged but unsynced remote update so we create a conflict.
            await this.resolveConflictAsync('local', file)

            if (file.local) {
              // In this case we can dissociate the remote record from its local
              // counterpart that was just renamed and will be merged later.
              metadata.dissociateLocal(file)
              // We make sure Sync will detect and propagate the remote update
              metadata.markSide('remote', file, file)
              return this.pouch.put(file)
            } else {
              // TODO: should we save the new metadata anyway to make sure we
              // have up-to-date side infos?
              return
            }
          } else {
            // We have a merged but unsynced local update so we create a conflict.
            // We use `doc` and not `file` because the remote document has changed
            // and its new revision is only available in `doc`.
            await this.resolveConflictAsync('remote', doc)

            if (file.remote) {
              // In this case we can dissociate the local record from its remote
              // counterpart that was just renamed and will be fetched later.
              metadata.dissociateRemote(file)
              // We make sure Sync will detect and propagate the local update
              metadata.markSide('local', file, file)
              return this.pouch.put(file)
            } else {
              // TODO: should we save the new metadata anyway to make sure we
              // have up-to-date side infos?
              return
            }
          }
        } else if (side === 'local' && isNote(file)) {
          // We'll need a reference to the "overwritten" note during the conflict
          // resolution.
          doc.overwrite = file
          return this.resolveNoteConflict(doc)
        } else {
          doc.overwrite = file
        }
      }

      if (metadata.sameFile(file, doc)) {
        log.info({ path: doc.path }, 'up to date')
        if (side === 'local' && !metadata.sameLocal(file.local, doc.local)) {
          metadata.updateLocal(file, doc.local)
          const outdated = metadata.outOfDateSide(file)
          if (outdated) {
            metadata.markSide(otherSide(outdated), file, file)
          }
          return this.pouch.put(file)
        }
        return null
      } else {
        metadata.markSide(side, doc, file.deleted ? null : file)
        metadata.assignMaxDate(doc, file)
        return this.pouch.put(doc)
      }
    }
  }

  // Create or update a folder
  async putFolderAsync(side /*: SideName */, doc /*: Metadata */) {
    log.debug({ path: doc.path }, 'putFolderAsync')
    const { path } = doc
    const folder /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)
    metadata.markSide(side, doc, folder)
    if (folder && folder.docType === 'file') {
      return this.resolveConflictAsync(side, doc)
    }
    metadata.assignMaxDate(doc, folder)
    const idConflict /*: ?IdConflictInfo */ = IdConflict.detect(
      { side, doc },
      folder
    )
    if (idConflict) {
      log.warn({ idConflict }, IdConflict.description(idConflict))
      await this.resolveConflictAsync(side, doc)
      return
    } else if (folder) {
      doc._id = folder._id
      doc._rev = folder._rev
      if (doc.remote == null) {
        doc.remote = folder.remote
      }
      if (doc.ino == null && folder.ino) {
        doc.ino = folder.ino
      }
      if (doc.fileid == null) {
        doc.fileid = folder.fileid
      }
      // If folder is updated on local filesystem, doc won't have metadata attribute
      if (folder.metadata && doc.metadata == null) {
        doc.metadata = folder.metadata
      }
      // If folder was updated on remote Cozy, doc won't have local attribute
      if (folder.local && doc.local == null) {
        doc.local = folder.local
      }

      if (metadata.sameFolder(folder, doc)) {
        if (needsFileidMigration(folder, doc.fileid)) {
          return this.migrateFileid(folder, doc.fileid)
        }
        log.info({ path }, 'up to date')
        if (side === 'local' && !metadata.sameLocal(folder.local, doc.local)) {
          metadata.updateLocal(folder, doc.local)
          const outdated = metadata.outOfDateSide(folder)
          if (outdated) {
            metadata.markSide(otherSide(outdated), folder, folder)
          }
          return this.pouch.put(folder)
        } else {
          return null
        }
      } else {
        return this.pouch.put(doc)
      }
    }
    await this.ensureParentExistAsync(side, doc)

    return this.pouch.put(doc)
  }

  // Rename or move a file
  async moveFileAsync(
    side /*: SideName */,
    doc /*: Metadata */,
    was /*: SavedMetadata */
  ) /*: Promise<*> */ {
    log.debug({ path: doc.path, oldpath: was.path }, 'moveFileAsync')
    const { path } = doc

    if (!metadata.wasSynced(was) || was.deleted) {
      metadata.markAsUnsyncable(was)
      metadata.markAsNew(doc)
      await this.pouch.put(was)
      return this.addFileAsync(side, doc)
    } else if (was.sides && was.sides[side]) {
      metadata.assignMaxDate(doc, was)
      move(side, was, doc)

      // If file is moved on Windows, it will never be executable so we keep the
      // existing value.
      if (side === 'local' && process.platform === 'win32') {
        doc.executable = was.executable
      }

      const file /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)
      if (file) {
        if (file.deleted) {
          doc.overwrite = file
        }

        const idConflict /*: ?IdConflictInfo */ = IdConflict.detect(
          { side, doc, was },
          file
        )
        if (idConflict) {
          log.warn({ idConflict }, IdConflict.description(idConflict))
          await this.resolveConflictAsync(side, doc)
          return
        }

        if (doc.overwrite || metadata.isAtLeastUpToDate(side, file)) {
          // On macOS and Windows, two documents can share the same id with a
          // different path.
          // This means we'll see moves with both `file` and `doc` sharing the
          // same id when changing the file name's case or encoding and in this
          // situation we're not actually doing an overwriting move so we
          // shouldn't reuse the existing `file`'s rev nor overwrite it.
          if (file.path === doc.path) {
            doc._id = file._id
            doc._rev = file._rev
            doc.overwrite = file
          }
          await this.ensureParentExistAsync(side, doc)

          if (side === 'local' && isNote(was) && doc.md5sum !== was.md5sum) {
            return this.resolveNoteConflict(doc, was)
          }

          return this.pouch.bulkDocs([was, doc])
        }

        if (metadata.sameFile(file, doc)) {
          // FIXME: this code block seems unreachable. Removing it does not
          // break any test.
          // We should make sure that is correct and remove it.
          log.info({ path }, 'up to date (move)')
          if (side === 'local' && !metadata.sameLocal(file.local, doc.local)) {
            metadata.updateLocal(file, doc.local)
            const outdated = metadata.outOfDateSide(file)
            if (outdated) {
              metadata.markSide(otherSide(outdated), file, file)
            }
            return this.pouch.bulkDocs([was, file])
          } else {
            return this.pouch.put(was)
          }
        }

        const dst = await this.resolveConflictAsync(side, doc)
        move(side, was, dst)
        return this.pouch.bulkDocs([was, dst])
      } else {
        await this.ensureParentExistAsync(side, doc)

        if (side === 'local' && isNote(was) && doc.md5sum !== was.md5sum) {
          return this.resolveNoteConflict(doc, was)
        }

        return this.pouch.bulkDocs([was, doc])
      }
    } else {
      // It can happen after a conflict
      return this.addFileAsync(side, doc)
    }
  }

  // Rename or move a folder (and every file and folder inside it)
  async moveFolderAsync(
    side /*: SideName */,
    doc /*: Metadata */,
    was /*: SavedMetadata */,
    newRemoteRevs /*: ?RemoteRevisionsByID */
  ) {
    log.debug({ path: doc.path, oldpath: was.path }, 'moveFolderAsync')

    if (!metadata.wasSynced(was)) {
      metadata.markAsUnsyncable(was)
      metadata.markAsNew(doc)
      await this.pouch.put(was)
      return this.putFolderAsync(side, doc)
    }

    metadata.assignMaxDate(doc, was)

    const folder /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)
    if (folder) {
      if (folder.deleted) {
        doc.overwrite = folder
      }

      const idConflict /*: ?IdConflictInfo */ = IdConflict.detect(
        { side, doc, was },
        folder
      )
      if (idConflict) {
        log.warn({ idConflict }, IdConflict.description(idConflict))
        await this.resolveConflictAsync(side, doc)
        return
      }

      if (doc.overwrite || metadata.isAtLeastUpToDate(side, folder)) {
        // On macOS and Windows, two documents can share the same id with a
        // different path.
        // This means we'll see moves with both `folder` and `doc` sharing the
        // same id when changing the folder name's case or encoding and in this
        // situation we're not actually doing an overwriting move so we
        // shouldn't reuse the existing `folder`'s rev nor overwrite it.
        if (folder.path === doc.path) {
          doc._id = folder._id
          doc._rev = folder._rev
          doc.overwrite = folder
        }
        await this.ensureParentExistAsync(side, doc)
        return this.moveFolderRecursivelyAsync(side, doc, was, newRemoteRevs)
      }

      if (metadata.sameFolder(folder, doc)) {
        log.info({ path }, 'up to date (move)')
        // TODO: what about the content that was maybe moved ?
        return this.pouch.put(was)
      }

      const dst = await this.resolveConflictAsync(side, doc)
      return this.moveFolderRecursivelyAsync(side, dst, was, newRemoteRevs)
    } else {
      await this.ensureParentExistAsync(side, doc)
      return this.moveFolderRecursivelyAsync(side, doc, was, newRemoteRevs)
    }
  }

  // Move a folder and all the things inside it
  async moveFolderRecursivelyAsync(
    side /*: SideName */,
    folder /*: Metadata  */,
    was /*: SavedMetadata */,
    newRemoteRevs /*: ?RemoteRevisionsByID */
  ) {
    log.debug(
      { path: folder.path, oldpath: was.path },
      'moveFolderRecursivelyAsync'
    )
    const docs = await this.pouch.byRecursivePath(was.path)
    const dstChildren = await this.pouch.byRecursivePath(folder.path)

    move(side, was, folder)
    let bulk = [was, folder]

    const makeDestinationPath = doc =>
      metadata.newChildPath(doc.path, was.path, folder.path)
    const existingDstRevs = await this.pouch.getAllRevs(
      docs.map(makeDestinationPath)
    )

    for (let doc of docs) {
      // Update remote rev of documents which have been updated on the Cozy
      // after we've detected the move.
      const newRemoteRev = _.get(newRemoteRevs, _.get(doc, 'remote._id'))
      if (newRemoteRev) doc.remote._rev = newRemoteRev

      const src = _.cloneDeep(doc)
      const dst = _.cloneDeep(doc)
      dst.path = makeDestinationPath(doc)

      // If the source needs to be overwritten, we'll take care of it during
      // Sync while it does not say anything about the existence of a document
      // at the destination.
      if (dst.overwrite) delete dst.overwrite

      if (folder.overwrite) {
        const dstChild = dstChildren.find(
          child => metadata.id(child.path) === metadata.id(dst.path)
        )
        if (dstChild) {
          dst._id = dstChild._id
          dst._rev = dstChild._rev
          dst.overwrite = dstChild
        }
      }
      // TODO: manage conflicts if not overwriting and docs exist at destination?

      const singleSide = metadata.detectSingleSide(src)
      if (singleSide) {
        move.convertToDestinationAddition(singleSide, src, dst)
      } else {
        move.child(side, src, dst)
      }

      bulk.push(src)

      const existingDstRev = existingDstRevs[metadata.id(dst.path)]
      // Filtering out deleted destination docs would mean failing to save the new version.
      // However, replacing the deleted docs will mean failing to propagate the change.
      if (existingDstRev && folder.overwrite) {
        dst._rev = existingDstRev
      }

      // FIXME: Find a cleaner way to pass the syncPath to the Merge
      const incompatibilities = metadata.detectIncompatibilities(
        dst,
        this.pouch.config.syncPath
      )
      if (incompatibilities.length > 0)
        dst.incompatibilities = incompatibilities
      else delete dst.incompatibilities

      if (side === 'local' && dst.sides.local) {
        // Update the local attribute of children existing in the local folder
        metadata.updateLocal(dst)
      } else if (side === 'remote' && dst.sides.remote) {
        // Update the remote attribute of children existing in the remote folder
        metadata.updateRemote(dst, { path: dst.path })
      }

      bulk.push(dst)

      if (folder.overwrite) {
        // If the overwriting folder has a deep hierarchy, there's a good chance
        // we'll end up merging the movement of its child folders before we
        // merge the movement of the folder itself.
        // In this situation, the Sync would apply the movement of the children
        // first as well and when we'll apply the overwriting movement of the
        // folder, we'll lose its previously moved content.
        // To avoid this, we'll update the moved children again to mark them as
        // child movements and remove any `overwrite` markers since the
        // overwrite will happen with their parent.
        for (const dstChild of dstChildren) {
          if (
            !bulk.find(
              doc => metadata.id(doc.path) === metadata.id(dstChild.path)
            ) &&
            metadata.outOfDateSide(dstChild) === otherSide(side) &&
            dstChild.moveFrom
          ) {
            metadata.markSide(side, dstChild, dstChild)
            dstChild.moveFrom.childMove = true
            if (dstChild.overwrite) delete dstChild.overwrite
            bulk.push(dstChild)
          }
        }
      }
    }
    return this.pouch.bulkDocs(bulk)
  }

  async doTrash(
    side /*: SideName */,
    was /*: Metadata */,
    doc /*: Metadata */
  ) /*: Promise<void> */ {
    if (
      side === 'remote' &&
      doc.docType === 'file' &&
      !metadata.sameBinary(was, doc)
    ) {
      // We have a conflict: the file was updated in local and trashed on the
      // remote. We dissociate the file on the remote to be able to apply the
      // local change.
      delete was.remote
      if (was.sides) delete was.sides.remote
      return this.pouch.put(was)
    }
    delete was.errors

    const newMetadata = _.cloneDeep(was)
    metadata.markSide(side, newMetadata, was)
    newMetadata.trashed = true
    if (was.sides && was.sides[side]) {
      metadata.markSide(side, was, was)
      was.deleted = true
      try {
        await this.pouch.put(was)
        return
      } catch (err) {
        log.warn({ path: doc.path, err })
        // Do we really want to save newMetadata in this situation? It will
        // probably fail as well.
      }
    }
    return this.pouch.put(newMetadata)
  }

  async trashFileAsync(
    side /*: SideName */,
    trashed /*: {path: string} */,
    doc /*: Metadata */
  ) /*: Promise<void> */ {
    const { path } = trashed
    log.debug({ path }, 'trashFileAsync')
    const was /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(
      trashed.path
    )

    if (!was) {
      log.debug({ path }, 'Nothing to trash')
      return
    } else if (doc.docType !== was.docType) {
      log.error(
        { doc, was, sentry: true },
        'Mismatch on doctype for trashFileAsync'
      )
      return
    }

    if (was.moveFrom) {
      // The file was moved and we don't want to delete it as we think users
      // delete "paths".
      if (side === 'remote') {
        // We update the remote rev so we can send the file again and undo the
        // remote trashing.
        was.remote._rev = doc.remote._rev
        // We keep the `moveFrom` hint so we will update the remote file and
        // restore it from the trash instead of re-uploading it.
        was.moveFrom.remote._rev = doc.remote._rev
      } else {
        // We remove the hint that the file should be moved since it has
        // actually been deleted locally and should be recreated instead.
        delete was.moveFrom
        // The file was deleted locally so it should not have a local side so we
        // can re-create it.
        delete was.sides.local
      }
      return this.pouch.put(was)
    }
    return this.doTrash(side, was, doc)
  }

  async trashFolderAsync(
    side /*: SideName */,
    trashed /*: {path: string} */,
    doc /*: Metadata */
  ) /*: Promise<*> */ {
    const { path } = trashed
    log.debug({ path }, 'trashFolderAsync')
    const was /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(
      trashed.path
    )

    if (!was) {
      log.debug({ path }, 'Nothing to trash')
      return
    } else if (doc.docType !== was.docType) {
      log.error(
        { doc, was, sentry: true },
        'Mismatch on doctype for trashFolderAsync'
      )
      return
    }

    // Don't trash a folder if the other side has added a new file in it (or updated one)
    const children = await this.pouch.byRecursivePath(was.path, {
      descending: true
    })
    for (let child of Array.from(children)) {
      if (
        child.docType === 'file' &&
        !child.deleted &&
        !metadata.isUpToDate(side, child)
      ) {
        // The parent folder was deleted on `side` so we remove this part anyway
        if (was.sides) delete was.sides[side]
        metadata.markSide(otherSide(side), was, was)
        if (side === 'local') {
          delete was.local
        } else {
          delete was.remote
        }
        delete was.errors
        // Remove deletion markers as we want the folder to be recreated on
        // `side` by Sync.
        delete was.trashed
        delete was.deleted
        // TODO: why prevent removing all files that were up-to-date?
        // Does this actually prevent removing the other files??
        return this.pouch.put(was)
      }
    }
    // Remove in pouchdb the sub-folders
    //
    // TODO: We could only one loop if the update of one child would not prevent
    // the trashing of the other children.
    for (let child of Array.from(children)) {
      if (child.docType === 'folder') {
        try {
          child.deleted = true
          await this.pouch.put(child)
        } catch (err) {
          log.warn({ path, err })
        }
      }
    }
    await this.doTrash(side, was, doc)
  }

  // Remove a file from PouchDB
  //
  // As the watchers often detect the deletion of a folder before the deletion
  // of the files inside it, deleteFile can be called for a file that has
  // already been removed. This is not considered as an error.
  async deleteFileAsync(side /*: SideName */, doc /*: SavedMetadata */) {
    log.debug({ path: doc.path }, 'deleteFileAsync')
    const file /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)

    if (!file) {
      log.debug({ path }, 'Nothing to delete')
      return
    }

    if (file.moveFrom) {
      // We don't want Sync to pick up this move hint and try to synchronize a
      // move so we delete it.
      delete file.moveFrom

      if (side === 'remote') {
        // The file was moved locally and we don't want to delete it as we think
        // users delete "paths" but the file was completely destroyed on the
        // Cozy and cannot be restored from the trash so we dissociate our
        // record from its previous remote version to force its re-upload.
        metadata.dissociateRemote(file)
        return this.pouch.put(file)
      }
    }
    if (file.sides && file.sides[side]) {
      metadata.markSide(side, file, file)
      file.deleted = true
      delete file.errors
      return this.pouch.put(file)
    } else {
      // It can happen after a conflict
      return
    }
  }

  // Remove a folder
  //
  // When a folder is removed in PouchDB, we also remove the files and folders
  // inside it to ensure consistency. The watchers often detects the deletion
  // of a nested folder after the deletion of its parent. In this case, the
  // call to deleteFolder for the child is considered as successful, even if
  // the folder is missing in pouchdb (error 404).
  async deleteFolderAsync(side /*: SideName */, doc /*: SavedMetadata */) {
    log.debug({ path: doc.path }, 'deleteFolderAsync')
    const folder /*: ?SavedMetadata */ = await this.pouch.bySyncedPath(doc.path)

    if (!folder) {
      log.debug({ path }, 'Nothing to delete')
      return
    }

    if (folder.moveFrom) {
      // We don't want Sync to pick up this move hint and try to synchronize a
      // move so we delete it.
      delete folder.moveFrom
    }

    if (folder.sides && folder.sides[side]) {
      return this.deleteFolderRecursivelyAsync(side, folder)
    } else {
      // It can happen after a conflict
      return
    }
  }

  // Remove a folder and every thing inside it
  async deleteFolderRecursivelyAsync(
    side /*: SideName */,
    folder /*: SavedMetadata */
  ) {
    // In the changes feed, nested subfolder must be deleted
    // before their parents, hence the reverse order.
    const docs = await this.pouch.byRecursivePath(folder.path, {
      descending: true
    })
    const toPreserve = new Set()
    for (let doc of docs) {
      if (doc.deleted) continue

      if (
        toPreserve.has(doc.path) ||
        (doc.sides && !metadata.isUpToDate(side, doc))
      ) {
        log.warn(
          {
            path: doc.path,
            ancestorPath: folder.path,
            otherSide: otherSide(side)
          },
          'Cannot be deleted with ancestor: document was modified on the other side.'
        )
        log.info({ path: doc.path }, 'Dissociating from remote...')
        metadata.dissociateRemote(doc)
        toPreserve.add(path.dirname(doc.path))
      } else {
        metadata.markSide(side, doc, doc)
        doc.deleted = true
        delete doc.errors
      }
    }

    metadata.markSide(side, folder, folder)
    folder.deleted = true
    delete folder.errors
    docs.push(folder)

    return this.pouch.bulkDocs(docs)
  }

  async bulkFixSideInPouch(
    {
      side,
      results,
      docs
    } /*: { side: SideName, results: { id: string, rev: string }[], docs: SavedMetadata[] } */
  ) /*: Promise<any> */ {
    log.debug({ side, results, docs }, 'bulkFixSideInPouch')
    const fixedDocs = []
    const uniqResultsById = _.chain(results)
      .sortBy('rev')
      .reverse()
      .uniqBy('id')
      .value()
    const reusingRevs = uniqResultsById.filter(this.isReusingRev)
    for (const { id, rev } of reusingRevs) {
      const doc = _.find(docs, doc => !doc._rev && doc._id === id)
      if (doc) {
        fixedDocs.push(this.fixSide({ side, rev, doc }))
      }
    }

    if (fixedDocs.length > 0) return this.pouch.bulkDocs(fixedDocs)
  }

  async fixSideInPouch(
    {
      side,
      result,
      doc
    } /*: { side: SideName, result: { rev: string }, doc: SavedMetadata } */
  ) /*: Promise<any> */ {
    log.debug({ side, result, doc }, 'fixSideInPouch')
    const { rev } = result

    if (!doc._rev && this.isReusingRev(result)) {
      const fixedDoc = this.fixSide({ side, rev, doc })
      return this.pouch.put(fixedDoc)
    }
  }

  isReusingRev({ rev } /*: { rev: string } */) /*: boolean */ {
    return metadata.extractRevNumber({ _rev: rev }) > 1
  }

  fixSide(
    {
      side,
      rev,
      doc
    } /*: { side: SideName, rev: string, doc: SavedMetadata } */
  ) /*: SavedMetadata */ {
    return _.defaults(
      {
        _rev: rev,
        sides: _.defaults(
          { [side]: metadata.extractRevNumber({ _rev: rev }) + 1 },
          doc.sides
        )
      },
      doc
    )
  }

  async migrateFileid(
    existing /*: SavedMetadata */,
    fileid /*: string */
  ) /*: Promise<void> */ {
    log.info({ path: existing.path, fileid }, 'Migrating fileid')
    const doc = _.defaults({ fileid }, existing)
    metadata.incSides(doc)
    await this.pouch.put(doc)
  }
}

const needsFileidMigration = (
  existing /*: SavedMetadata */,
  fileid /*: ?string */
) /*: boolean %checks */ => existing.fileid == null && fileid != null

module.exports = {
  Merge,
  MergeMissingParentError
}
