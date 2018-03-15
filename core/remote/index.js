/* @flow */

import type { RemoteDoc } from './document'
import type { FileStreamProvider, ReadableWithContentLength } from '../file_stream_provider' // eslint-disable-line
import type { Metadata } from '../metadata'
import type { Side } from '../side' // eslint-disable-line

const EventEmitter = require('events')
const { posix, sep } = require('path')

const Config = require('../config')
const conversion = require('../conversion')
const RemoteCozy = require('./cozy')
const logger = require('../logger')
const Pouch = require('../pouch')
const Prep = require('../prep')
const Watcher = require('./watcher')
const measureTime = require('../perftools')
const { withContentLength } = require('../file_stream_provider')

const log = logger({
  component: 'RemoteWriter'
})

module.exports = class Remote implements Side {
  other: FileStreamProvider
  pouch: Pouch
  events: EventEmitter
  watcher: Watcher
  remoteCozy: RemoteCozy

  constructor (config: Config, prep: Prep, pouch: Pouch, events: EventEmitter) {
    this.pouch = pouch
    this.events = events
    this.remoteCozy = new RemoteCozy(config)
    this.watcher = new Watcher(pouch, prep, this.remoteCozy, events)
  }

  start () {
    return this.watcher.start()
  }

  stop () {
    return this.watcher.stop()
  }

  sendMail (args: any) {
    return this.remoteCozy.createJob('sendmail', args)
  }

  unregister () {
    return this.remoteCozy.unregister()
  }

  // Create a readable stream for the given doc
  async createReadStreamAsync (doc: Metadata): Promise<ReadableWithContentLength> {
    const stream = await this.remoteCozy.downloadBinary(doc.remote._id)
    return withContentLength(stream, doc.size)
  }

  // Create a folder on the remote cozy instance
  async addFolderAsync (doc: Metadata): Promise<Metadata> {
    const {path} = doc
    log.info({path}, 'Creating folder...')

    const [parentPath, name] = conversion.extractDirAndName(doc.path)
    const parent: RemoteDoc = await this.remoteCozy.findOrCreateDirectoryByPath(parentPath)
    let dir: RemoteDoc

    try {
      dir = await this.remoteCozy.createDirectory({
        name,
        dirID: parent._id,
        lastModifiedDate: doc.updated_at
      })
    } catch (err) {
      if (err.status !== 409) { throw err }

      log.info({path}, 'Folder already exists')
      const remotePath = '/' + posix.join(...doc.path.split(sep))
      dir = await this.remoteCozy.findDirectoryByPath(remotePath)
    }

    doc.remote = {
      _id: dir._id,
      _rev: dir._rev
    }

    return conversion.createMetadata(dir)
  }

  async addFileAsync (doc: Metadata): Promise<Metadata> {
    const {path} = doc
    log.info({path}, 'Uploading new file...')
    const stopMeasure = measureTime('RemoteWriter#addFile')

    let stream: ReadableWithContentLength
    try {
      stream = await this.other.createReadStreamAsync(doc)
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.warn({path}, 'Local file does not exist anymore.')
        doc._deleted = true // XXX: This prevents the doc to be saved with new revs
        return doc
      }
      throw err
    }

    const [dirPath, name] = conversion.extractDirAndName(path)
    const dir = await this.remoteCozy.findOrCreateDirectoryByPath(dirPath)

    const created = await this.remoteCozy.createFile(stream, {
      name,
      dirID: dir._id,
      executable: doc.executable,
      contentLength: stream.contentLength,
      contentType: doc.mime,
      lastModifiedDate: new Date(doc.updated_at)
    })

    doc.remote = {
      _id: created._id,
      _rev: created._rev
    }

    stopMeasure()
    // TODO do we use the returned values somewhere?
    return conversion.createMetadata(created)
  }

  async overwriteFileAsync (doc: Metadata, old: ?Metadata): Promise<Metadata> {
    const {path} = doc
    log.info({path}, 'Uploading new file version...')

    let stream
    try {
      stream = await this.other.createReadStreamAsync(doc)
    } catch (err) {
      if (err.code === 'ENOENT') {
        log.warn({path}, 'Local file does not exist anymore.')
        doc._deleted = true // XXX: This prevents the doc to be saved with new revs
        return doc
      }
      throw err
    }

    const options = {
      contentType: doc.mime,
      checksum: doc.md5sum,
      lastModifiedDate: new Date(doc.updated_at),
      ifMatch: ''
    }
    if (old && old.remote) {
      options.ifMatch = old.remote._rev
    }
    const updated = await this.remoteCozy.updateFileById(doc.remote._id, stream, options)

    doc.remote._rev = updated._rev

    return conversion.createMetadata(updated)
  }

  async updateFileMetadataAsync (doc: Metadata, old: any): Promise<Metadata> {
    const {path} = doc
    log.info({path}, 'Updating file metadata...')

    const attrs = {
      executable: doc.executable,
      updated_at: doc.updated_at
    }
    const opts = {
      ifMatch: old.remote._rev
    }
    const updated = await this.remoteCozy.updateAttributesById(old.remote._id, attrs, opts)

    doc.remote = {
      _id: updated._id,
      _rev: updated._rev
    }

    return conversion.createMetadata(updated)
  }

  async moveFileAsync (newMetadata: Metadata, oldMetadata: Metadata): Promise<Metadata> {
    const {path} = newMetadata
    log.info({path}, `Moving from ${oldMetadata.path} ...`)

    const [newDirPath, newName]: [string, string] = conversion.extractDirAndName(path)
    const newDir: RemoteDoc = await this.remoteCozy.findDirectoryByPath(newDirPath)

    const attrs = {
      name: newName,
      dir_id: newDir._id,
      updated_at: newMetadata.updated_at
    }
    const opts = {
      ifMatch: oldMetadata.remote._rev
    }

    const newRemoteDoc: RemoteDoc = await this.remoteCozy.updateAttributesById(oldMetadata.remote._id, attrs, opts)

    newMetadata.remote = {
      _id: newRemoteDoc._id,
      _rev: newRemoteDoc._rev
    }

    return conversion.createMetadata(newRemoteDoc)
  }

  async updateFolderAsync (doc: Metadata, old: Metadata): Promise<Metadata> {
    const {path} = doc
    if (!old.remote) {
      return this.addFolderAsync(doc)
    }
    log.info({path}, 'Updating metadata...')

    const [newParentDirPath, newName] = conversion.extractDirAndName(path)
    const newParentDir = await this.remoteCozy.findDirectoryByPath(newParentDirPath)
    let newRemoteDoc: RemoteDoc

    const attrs = {
      name: newName,
      dir_id: newParentDir._id,
      updated_at: doc.updated_at
    }
    const opts = {
      ifMatch: old.remote._rev
    }

    try {
      newRemoteDoc = await this.remoteCozy.updateAttributesById(old.remote._id, attrs, opts)
    } catch (err) {
      if (err.status !== 404) { throw err }

      log.warn({path}, "Directory doesn't exist anymore. Recreating it...")
      newRemoteDoc = await this.remoteCozy.createDirectory({
        name: newName,
        dirID: newParentDir._id,
        lastModifiedDate: doc.updated_at
      })
    }

    doc.remote = {
      _id: newRemoteDoc._id,
      _rev: newRemoteDoc._rev
    }

    return conversion.createMetadata(newRemoteDoc)
  }

  async trashAsync (doc: Metadata): Promise<void> {
    const {path} = doc
    log.info({path}, 'Moving to the trash...')
    let newRemoteDoc: RemoteDoc
    try {
      newRemoteDoc = await this.remoteCozy.trashById(doc.remote._id, {
        ifMatch: doc.remote._rev
      })
    } catch (err) {
      if (err.status === 404) {
        log.warn({path}, `Cannot trash remotely deleted ${doc.docType}.`)
        return
      }
      throw err
    }
    doc.remote._rev = newRemoteDoc._rev
  }

  async deleteFolderAsync (doc: Metadata): Promise<void> {
    await this.trashAsync(doc)
    const {path} = doc

    try {
      if (await this.remoteCozy.isEmpty(doc.remote._id)) {
        log.info({path}, 'Deleting folder from the Cozy trash...')
        const opts = doc.remote._rev ? { ifMatch: doc.remote._rev } : undefined
        await this.remoteCozy.destroyById(doc.remote._id, opts)
      } else {
        log.warn({path}, 'Folder is not empty and cannot be deleted!')
      }
    } catch (err) {
      if (err.status === 404) return
      throw err
    }
  }

  async assignNewRev (doc: Metadata): Promise<*> {
    log.info({path: doc.path}, 'Assigning new rev...')
    const {_rev} = await this.remoteCozy.client.files.statById(doc.remote._id)
    doc.remote._rev = _rev
  }

  async moveFolderAsync (newMetadata: Metadata, oldMetadata: Metadata): Promise<*> {
    // FIXME: same as moveFileAsync? Rename to moveAsync?
    const {path} = newMetadata
    log.info({path}, `Moving dir from ${oldMetadata.path} ...`)

    const [newDirPath, newName]: [string, string] = conversion.extractDirAndName(path)
    const newDir: RemoteDoc = await this.remoteCozy.findDirectoryByPath(newDirPath)

    const attrs = {
      name: newName,
      dir_id: newDir._id,
      updated_at: newMetadata.updated_at
    }
    const opts = {
      ifMatch: oldMetadata.remote._rev
    }

    const newRemoteDoc: RemoteDoc = await this.remoteCozy.updateAttributesById(oldMetadata.remote._id, attrs, opts)

    newMetadata.remote = {
      _id: newRemoteDoc._id, // XXX: Why do we reassign id? Isn't it the same as before?
      _rev: newRemoteDoc._rev
    }

    return conversion.createMetadata(newRemoteDoc)
  }

  diskUsage (): Promise<*> {
    return this.remoteCozy.diskUsage()
  }

  // TODO add tests
  async renameConflictingDocAsync (doc: Metadata, newPath: string): Promise<void> {
    const {path} = doc
    log.info({path}, `Resolve a conflict: ${path} → ${newPath}`)
    const newName = conversion.extractDirAndName(newPath)[1]
    await this.remoteCozy.updateAttributesById(doc.remote._id, {
      name: newName
    })
  }
}
