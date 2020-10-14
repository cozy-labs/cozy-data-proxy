/**
 * @module core/sync
 * @flow
 */

const autoBind = require('auto-bind')
const Promise = require('bluebird')

const { dirname } = require('path')
const _ = require('lodash')

const metadata = require('./metadata')
const { handleCommonCozyErrors } = require('./remote/cozy')
const { HEARTBEAT } = require('./remote/watcher')
const { otherSide } = require('./side')
const logger = require('./utils/logger')
const measureTime = require('./utils/perfs')
const { LifeCycle } = require('./utils/lifecycle')

/*::
import type EventEmitter from 'events'
import type { Ignore } from './ignore'
import type Local from './local'
import type { Pouch } from './pouch'
import type { Remote } from './remote'
import type { Metadata } from './metadata'
import type { SideName } from './side'
import type { Writer } from './writer'
*/

const log = logger({
  component: 'Sync'
})

const MAX_SYNC_ATTEMPTS = 3

const TRASHING_DELAY = 1000

/*::
export type MetadataChange = {
  changes: {rev: string}[],
  doc: Metadata,
  id: string,
  seq: number
};

export type SyncMode =
  | "pull"
  | "push"
  | "full";
*/

const isMarkedForDeletion = (doc /*: Metadata */) => {
  // During a transition period, we'll need to consider both documents with the
  // deletion marker and documents which were deleted but not yet synced before
  // the application was updated and are thus completely _deleted from PouchDB.
  return doc.deleted || doc._deleted
}

// This method lets us completely erase a document from PouchDB after the
// propagation of a deleted doc while removing all attributes that could get
// picked up by the Sync the next time the document shows up in the changesfeed
// (erasing documents generates changes) and thus result in an attempt to take
// action.
const eraseDocument = async (
  { _id, _rev } /*: Metadata */,
  { pouch } /*: { pouch: Pouch } */
) => {
  await pouch.db.put({ _id, _rev, _deleted: true })
}

// Sync listens to PouchDB about the metadata changes, and calls local and
// remote sides to apply the changes on the filesystem and remote CouchDB
// respectively.
class Sync {
  /*::
  changes: any
  events: EventEmitter
  ignore: Ignore
  local: Local
  pouch: Pouch
  remote: Remote
  moveTo: ?string
  lifecycle: LifeCycle

  diskUsage: () => Promise<*>
  */

  // FIXME: static TRASHING_DELAY = TRASHING_DELAY

  constructor(
    pouch /*: Pouch */,
    local /*: Local */,
    remote /*: Remote */,
    ignore /*: Ignore */,
    events /*: EventEmitter */
  ) {
    this.pouch = pouch
    this.local = local
    this.remote = remote
    this.ignore = ignore
    this.events = events
    this.local.other = this.remote
    this.remote.other = this.local
    this.lifecycle = new LifeCycle(log)

    autoBind(this)
  }

  // Start to synchronize the remote cozy with the local filesystem
  // First, start metadata synchronization in pouch, with the watchers
  // Then, when a stable state is reached, start applying changes from pouch
  async start() /*: Promise<void> */ {
    if (this.lifecycle.willStop()) {
      await this.lifecycle.stopped()
    } else {
      return
    }

    try {
      this.lifecycle.begin('start')
    } catch (err) {
      return
    }
    try {
      await this.local.start()
      await this.remote.start()
    } catch (err) {
      this.error(err)
      this.lifecycle.end('start')
      await this.stop()
      return
    }
    this.lifecycle.end('start')

    Promise.all([
      this.local.watcher.running,
      this.remote.watcher.running
    ]).catch(err => {
      this.error(err)
      this.stop()
      return
    })

    try {
      while (!this.lifecycle.willStop()) {
        await this.sync()
      }
    } catch (err) {
      this.error(err)
      await this.stop()
    }
  }

  async started() {
    await this.lifecycle.started()
  }

  // Manually force a full synchronization
  async forceSync() {
    await this.stop()
    await this.start()
  }

  // Stop the synchronization
  async stop() /*: Promise<void> */ {
    if (this.lifecycle.willStart()) {
      await this.lifecycle.started()
    } else {
      return
    }

    try {
      this.lifecycle.begin('stop')
    } catch (err) {
      return
    }
    if (this.changes) {
      this.changes.cancel()
      this.changes = null
    }

    await Promise.all([this.local.stop(), this.remote.stop()])
    this.lifecycle.end('stop')
  }

  async stopped() {
    await this.lifecycle.stopped()
  }

  error(err /*: Error */) {
    log.error({ err }, 'sync error')
    this.events.emit('sync-error', err)
  }

  // TODO: remove waitForNewChanges to .start while(true)
  async sync(waitForNewChanges /*: boolean */ = true) /*: Promise<*> */ {
    let seq = await this.pouch.getLocalSeq()
    if (waitForNewChanges) {
      const change = await this.waitForNewChanges(seq)
      if (change == null) return
    }
    const release = await this.pouch.lock(this)
    this.events.emit('sync-start')
    try {
      await this.syncBatch()
    } finally {
      this.events.emit('sync-end')
      release()
    }
    log.debug('No more metadata changes for now')
  }

  // sync
  async syncBatch() {
    let seq = null
    // eslint-disable-next-line no-constant-condition
    while (!this.lifecycle.willStop()) {
      seq = await this.pouch.getLocalSeq()
      // TODO: Prevent infinite loop
      const change = await this.getNextChange(seq)
      if (change == null) break
      this.events.emit('sync-current', change.seq)
      try {
        await this.apply(change)
        // XXX: apply should call setLocalSeq
      } catch (err) {
        if (!this.lifecycle.willStop()) throw err
      }
    }
  }

  // We filter with the byPath view to reject design documents
  //
  // Note: it is difficult to pick only one change at a time because pouch can
  // emit several docs in a row, and `limit: 1` seems to be not effective!
  async baseChangeOptions(seq /*: number */) /*: Object */ {
    return {
      limit: 1,
      since: seq,
      filter: '_view',
      view: 'byPath',
      returnDocs: false
    }
  }

  async waitForNewChanges(seq /*: number */) {
    log.trace({ seq }, 'Waiting for changes since seq')
    const opts = await this.baseChangeOptions(seq)
    opts.live = true
    return new Promise((resolve, reject) => {
      this.lifecycle.once('will-stop', resolve)
      this.changes = this.pouch.db
        .changes(opts)
        .on('change', data => {
          this.lifecycle.off('will-stop', resolve)
          if (this.changes) {
            this.changes.cancel()
            this.changes = null
            resolve(data)
          }
        })
        .on('error', err => {
          this.lifecycle.off('will-stop', resolve)
          if (this.changes) {
            this.changes.cancel()
            this.changes = null
            reject(err)
          }
        })
    })
  }

  async getNextChange(seq /*: number */) /*: Promise<?MetadataChange> */ {
    const stopMeasure = measureTime('Sync#getNextChange')
    const opts = await this.baseChangeOptions(seq)
    opts.include_docs = true
    const p = new Promise((resolve, reject) => {
      this.lifecycle.once('will-stop', resolve)
      this.changes = this.pouch.db
        .changes(opts)
        .on('change', data => {
          this.lifecycle.off('will-stop', resolve)
          resolve(data)
        })
        .on('error', err => {
          this.lifecycle.off('will-stop', resolve)
          reject(err)
        })
        .on('complete', data => {
          this.lifecycle.off('will-stop', resolve)
          if (data.results == null || data.results.length === 0) {
            resolve(null)
          }
        })
    })
    stopMeasure()
    return p
  }

  // Apply a change to both local and remote
  // At least one side should say it has already this change
  // In some cases, both sides have the change
  async apply(change /*: MetadataChange */) /*: Promise<*> */ {
    let { doc, seq } = change
    const { path } = doc
    log.debug({ path, seq, doc }, 'Applying change...')

    if (metadata.shouldIgnore(doc, this.ignore)) {
      return this.pouch.setLocalSeq(change.seq)
    } else if (!metadata.wasSynced(doc) && isMarkedForDeletion(doc)) {
      await eraseDocument(doc, this)
      return this.pouch.setLocalSeq(change.seq)
    }

    // FIXME: Acquire lock for as many changes as possible to prevent next huge
    // remote/local batches to acquite it first
    const [side, sideName] = this.selectSide(doc)
    let stopMeasure = () => {}
    try {
      stopMeasure = measureTime('Sync#applyChange:' + sideName)

      if (!side) {
        log.info({ path }, 'up to date')
        return this.pouch.setLocalSeq(change.seq)
      } else if (sideName === 'remote' && doc.trashed) {
        // File or folder was just deleted locally
        const byItself = await this.trashWithParentOrByItself(doc, side)
        if (!byItself) {
          return
        }
      } else {
        await this.applyDoc(doc, side, sideName)
      }

      await this.pouch.setLocalSeq(change.seq)
      log.trace({ path, seq }, `Applied change on ${sideName} side`)

      // Clean up documents so that we don't mistakenly take action based on
      // previous changes and keep our Pouch documents as small as possible
      // and especially avoid deep nesting levels.
      if (doc.deleted) {
        await eraseDocument(doc, this)
      } else {
        delete doc.moveFrom
        delete doc.overwrite
        // We also update the sides in case the document is not erased
        await this.updateRevs(doc, sideName)
      }
    } catch (err) {
      await this.handleApplyError(change, sideName, err)
    } finally {
      stopMeasure()
    }
  }

  async applyDoc(
    doc /*: Metadata */,
    side /*: Writer */,
    sideName /*: SideName */
  ) /*: Promise<*> */ {
    const currentRev = metadata.side(doc, sideName)

    if (doc.incompatibilities && sideName === 'local' && doc.moveTo == null) {
      const was = doc.moveFrom
      if (was != null && was.incompatibilities == null) {
        // Move compatible -> incompatible
        if (was.childMove == null) {
          log.warn(
            {
              path: doc.path,
              oldpath: was.path,
              incompatibilities: doc.incompatibilities
            },
            `Trashing ${sideName} ${doc.docType} since new remote one is incompatible`
          )
          await side.trashAsync(was)
          this.events.emit('delete-file', _.clone(was))
        } else {
          log.debug(
            { path: doc.path, incompatibilities: doc.incompatibilities },
            `incompatible ${doc.docType} should have been trashed with parent`
          )
        }
      } else {
        log.warn(
          { path: doc.path, incompatibilities: doc.incompatibilities },
          `Not syncing incompatible ${doc.docType}`
        )
      }
    } else if (doc.docType !== 'file' && doc.docType !== 'folder') {
      throw new Error(`Unknown docType: ${doc.docType}`)
    } else if (isMarkedForDeletion(doc) && currentRev === 0) {
      // do nothing
    } else if (doc.moveTo != null) {
      log.debug(
        { path: doc.path },
        `Ignoring deleted ${doc.docType} metadata as move source`
      )
    } else if (doc.moveFrom != null) {
      const from = (doc.moveFrom /*: Metadata */)
      log.debug(
        { path: doc.path },
        `Applying ${doc.docType} change with moveFrom`
      )

      if (from.incompatibilities && sideName === 'local') {
        await this.doAdd(side, doc)
      } else if (from.childMove) {
        await side.assignNewRemote(doc)
        if (doc.docType === 'file') {
          this.events.emit('transfer-move', _.clone(doc), _.clone(from))
        }
      } else {
        if (from.moveFrom && from.moveFrom.childMove) {
          await side.assignNewRemote(from)
        }
        await this.doMove(side, doc, from)
      }
      if (
        !metadata.sameBinary(from, doc) ||
        (from.overwrite && !metadata.sameBinary(from.overwrite, doc))
      ) {
        try {
          await side.overwriteFileAsync(doc, doc) // move & update
        } catch (err) {
          // the move succeeded, delete moveFrom to avoid re-applying it
          delete doc.moveFrom
          throw err
        }
      }
    } else if (isMarkedForDeletion(doc)) {
      log.debug({ path: doc.path }, `Applying ${doc.docType} deletion`)
      if (doc.docType === 'file') await side.trashAsync(doc)
      else await side.deleteFolderAsync(doc)
      this.events.emit('delete-file', _.clone(doc))
    } else if (currentRev === 0) {
      log.debug({ path: doc.path }, `Applying ${doc.docType} addition`)
      await this.doAdd(side, doc)
    } else {
      log.debug({ path: doc.path }, `Applying else for ${doc.docType} change`)
      let old
      try {
        old = (await this.pouch.getPreviousRev(
          doc._id,
          doc.sides.target - currentRev
        ) /*: ?Metadata */)
      } catch (err) {
        await this.doOverwrite(side, doc)
      }

      if (old) {
        if (doc.docType === 'folder') {
          if (metadata.sameFolder(old, doc)) {
            log.debug({ path: doc.path }, 'Ignoring timestamp-only change')
          } else {
            await side.updateFolderAsync(doc)
          }
        } else if (metadata.sameBinary(old, doc)) {
          if (metadata.sameFile(old, doc)) {
            log.debug({ path: doc.path }, 'Ignoring timestamp-only change')
          } else {
            await side.updateFileMetadataAsync(doc)
          }
        } else {
          if (sideName === 'local' && !doc.overwrite) {
            const copy = await this.local.createBackupCopyAsync(doc)
            await this.local.trashAsync(copy)
          }
          await side.overwriteFileAsync(doc, old)
          this.events.emit('transfer-started', _.clone(doc))
        }
      } // TODO else what do we do ?
    }
  }

  async doAdd(side /*: Writer */, doc /*: Metadata */) /*: Promise<void> */ {
    if (doc.docType === 'file') {
      await side.addFileAsync(doc)
      this.events.emit('transfer-started', _.clone(doc))
    } else {
      await side.addFolderAsync(doc)
    }
  }

  async doOverwrite(
    side /*: Writer */,
    doc /*: Metadata */
  ) /*: Promise<void> */ {
    if (doc.docType === 'file') {
      // TODO: risky overwrite without If-Match
      await side.overwriteFileAsync(doc, null)
      this.events.emit('transfer-started', _.clone(doc))
    } else {
      await side.addFolderAsync(doc)
    }
  }

  async doMove(
    side /*: Writer */,
    doc /*: Metadata */,
    old /*: Metadata */
  ) /*: Promise<void> */ {
    await side.moveAsync(doc, old)
    if (doc.docType === 'file') {
      this.events.emit('transfer-move', _.clone(doc), _.clone(old))
    }
  }

  // Select which side will apply the change
  // It returns the side, its name, and also the last rev applied by this side
  selectSide(doc /*: Metadata */) {
    switch (metadata.outOfDateSide(doc)) {
      case 'local':
        return [this.local, 'local']
      case 'remote':
        return [this.remote, 'remote']
      default:
        return []
    }
  }

  // Make the error explicit (offline, local disk full, quota exceeded, etc.)
  // and keep track of the number of retries
  async handleApplyError(
    change /*: MetadataChange */,
    sideName /*: SideName */,
    err /*: * */
  ) {
    const { path } = change.doc
    if (err.code === 'ENOSPC') {
      log.error({ path, err, change }, 'No more disk space')
      throw new Error('No more disk space')
    } else if (err.status === 412) {
      log.warn({ path, err, change }, 'Sync error 412 needs Merge')
      change.doc.errors = MAX_SYNC_ATTEMPTS
      return this.updateErrors(change, sideName)
    } else if (err.status === 413) {
      log.error({ path, err, change }, 'Cozy is full')
      throw new Error('Cozy is full')
    } else {
      log.error({ path, err, change }, 'Unknown sync error')
    }
    try {
      await this.diskUsage()
    } catch (err) {
      const result = handleCommonCozyErrors(
        { err, change },
        { events: this.events, log }
      )
      if (result === 'offline') {
        // The client is offline, wait that it can connect again to the server
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            await Promise.delay(60000)
            await this.diskUsage()
            this.events.emit('online')
            log.warn({ path }, 'Client is online')
            return
          } catch (err) {
            // Client is still offline
          }
        }
      }
    }
    await this.updateErrors(change, sideName)
  }

  // Increment the counter of errors for this document
  async updateErrors(
    change /*: MetadataChange */,
    sideName /*: SideName */
  ) /*: Promise<void> */ {
    let { doc } = change
    if (!doc.errors) doc.errors = 0
    doc.errors++

    // Make sure isUpToDate(sourceSideName, doc) is still true
    const sourceSideName = otherSide(sideName)
    metadata.markSide(sourceSideName, doc, doc)

    // Don't try more than MAX_SYNC_ATTEMPTS for the same operation
    if (doc.errors && doc.errors >= MAX_SYNC_ATTEMPTS) {
      log.error(
        { path: doc.path, oldpath: _.get(change, 'was.path') },
        `Failed to sync ${MAX_SYNC_ATTEMPTS} times. Giving up.`
      )
      await this.pouch.setLocalSeq(change.seq)
      // FIXME: final doc.errors is not saved which works but may be confusing.
      return
    }
    try {
      // The sync error may be due to the remote cozy being overloaded.
      // So, it's better to wait a bit before trying the next operation.
      // TODO: Wait for some increasing delay before saving errors
      await this.pouch.db.put(doc)
    } catch (err) {
      // If the doc can't be saved, it's because of a new revision.
      // So, we can skip this revision
      log.info(`Ignored ${change.seq}`, err)
      await this.pouch.setLocalSeq(change.seq)
    }
  }

  // Update rev numbers for both local and remote sides
  async updateRevs(
    doc /*: Metadata */,
    side /*: SideName */
  ) /*: Promise<*> */ {
    metadata.markAsUpToDate(doc)
    try {
      await this.pouch.put(doc)
    } catch (err) {
      // Conflicts can happen here, for example if the cozy-stack has generated
      // a thumbnail before apply has finished. In that case, we try to
      // reconciliate the documents.
      if (err && err.status === 409) {
        const unsynced /*: Metadata */ = await this.pouch.db.get(doc._id)
        const other = otherSide(side)
        await this.pouch.put({
          ...unsynced,
          sides: {
            target: unsynced.sides.target + 1, // increase target because of new merge
            [side]: doc.sides.target,
            [other]: unsynced.sides[other] + 1 // increase side to mark change as applied
          }
        })
      } else {
        log.warn({ path: doc.path, err }, 'Race condition')
      }
    }
  }

  // Trash a file or folder. If a folder was deleted on local, we try to trash
  // only this folder on the remote, not every files and folders inside it, to
  // preserve the tree in the trash.
  async trashWithParentOrByItself(
    doc /*: Metadata */,
    side /*: Writer */
  ) /*: Promise<boolean> */ {
    let parentId = dirname(doc._id)
    if (parentId !== '.') {
      let parent /*: Metadata */ = await this.pouch.db.get(parentId)

      if (!parent.trashed) {
        await Promise.delay(TRASHING_DELAY)
        parent = await this.pouch.db.get(parentId)
      }

      if (parent.trashed && !metadata.isUpToDate('remote', parent)) {
        log.info(`${doc.path}: will be trashed with parent directory`)
        await this.trashWithParentOrByItself(parent, side)
        // Wait long enough that the remote has fetched one changes feed
        // TODO find a way to trigger the changes feed instead of waiting for it
        await Promise.delay(HEARTBEAT)
        return false
      }
    }

    log.info(`${doc.path}: should be trashed by itself`)
    await side.trashAsync(doc)
    this.events.emit('delete-file', _.clone(doc))
    return true
  }
}

module.exports = Sync
