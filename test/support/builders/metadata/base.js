/* @flow */

const _ = require('lodash')
const path = require('path')

const metadata = require('../../../../core/metadata')
const timestamp = require('../../../../core/timestamp')

const dbBuilders = require('../db')

/*::
import type fs from 'fs-extra'
import type {
  Metadata,
  MetadataRemoteInfo,
  MetadataSidesInfo,
  SideName
} from '../../../../core/metadata'
import type Pouch from '../../../../core/pouch'
import type { RemoteDoc } from '../../../../core/remote/document'
*/

module.exports = class BaseMetadataBuilder {
  /*::
  pouch: ?Pouch
  doc: Metadata
  old: ?Metadata
  */

  constructor (pouch /*: ?Pouch */, old /*: ?Metadata */) {
    this.pouch = pouch
    if (old) {
      this.old = old
      this.doc = _.cloneDeep(old)
    } else {
      this.doc = {
        _id: metadata.id('foo'),
        docType: 'folder', // To make flow happy (overridden by subclasses)
        path: 'foo',
        remote: {
          _id: dbBuilders.id(),
          _rev: dbBuilders.rev()
        },
        tags: [],
        sides: {},
        updated_at: timestamp.current().toISOString()
      }
    }
  }

  fromRemote (remoteDoc /*: RemoteDoc */) /*: this */ {
    this.doc = metadata.fromRemoteDoc(remoteDoc)
    metadata.ensureValidPath(this.doc)
    this._assignId()
    return this
  }

  moveFrom (was /*: Metadata */) /*: this */ {
    this.doc.moveFrom = _.defaultsDeep({ moveTo: this.doc._id }, was)
    this.noRev()
    return this
  }

  /** Make sure the doc is not the same as before. */
  whateverChange () /*: this */ {
    this.doc.tags = this.doc.tags || []
    this.doc.tags.push('changed-tag')
    return this
  }

  unmerged (sideName /*: SideName */) /*: this */ {
    if (this.doc.docType === 'file') delete this.doc.sides
    if (sideName === 'local') this.noRemote()
    return this.noRev()
  }

  rev (rev /*: string */) /*: this */ {
    this.doc._rev = rev
    return this
  }

  noRev () /*: this */ {
    delete this.doc._rev
    return this
  }

  noRemote () /*: this */ {
    /*
     * $FlowFixMe Flow is lying to us when allowing metadata's buildFile and
     * buildDir to set remote to undefined
     */
    this.doc.remote = undefined
    return this
  }

  incompatible () /*: this */ {
    const { platform } = process

    if (platform === 'win32' || platform === 'darwin') {
      // Colon is currently considered forbidden on both platforms by the app
      // (although it probably shouldn't on macOS).
      return this.path('in:compatible')
    } else {
      throw new Error(`Cannot build incompatible doc on ${platform}`)
    }
  }

  ino (ino /*: number */) /*: this */ {
    this.doc.ino = ino
    return this
  }

  fileid (fileid /*: string */) /*: this */ {
    this.doc.fileid = fileid
    return this
  }

  stats ({ino, mtime, ctime} /*: fs.Stats */) /*: this */ {
    return this.ino(ino).updatedAt(timestamp.maxDate(mtime, ctime))
  }

  path (newPath /*: string */) /*: this */ {
    this.doc.path = path.normalize(newPath)
    metadata.ensureValidPath(this.doc)
    this._assignId()
    return this
  }

  overwrite (existingDoc /*: Metadata */) /*: this */ {
    this.doc.overwrite = existingDoc
    return this
  }

  trashed () /*: this */ {
    this.doc.trashed = true
    return this
  }

  updatedAt (date /*: Date */) /*: this */ {
    this.doc.updated_at = timestamp.fromDate(date).toISOString()
    return this
  }

  newerThan (doc /*: Metadata */) /*: this */ {
    this.doc.updated_at = timestamp.fromDate(new Date(timestamp.fromDate(doc.updated_at).getTime() + 2000)).toISOString()
    return this
  }

  olderThan (doc /*: Metadata */) /*: this */ {
    this.doc.updated_at = timestamp.fromDate(new Date(timestamp.fromDate(doc.updated_at).getTime() - 2000)).toISOString()
    return this
  }

  remoteId (_id /*: string */) /*: this */ {
    this.doc.remote = {
      _id,
      _rev: dbBuilders.rev()
    }
    return this
  }

  upToDate () /*: this */ {
    this.doc.sides = {local: 2, remote: 2}
    return this
  }

  notUpToDate () /*: this */ {
    this.doc.sides = {remote: 1}
    return this
  }

  changedSide (side /*: SideName */) /*: this */ {
    metadata.markSide(side, this.doc, this.old)
    return this
  }

  sides (sides /*: MetadataSidesInfo */) /*: this */ {
    this.doc.sides = sides
    return this
  }

  tags (...tags /*: string[] */) /*: this */ {
    this.doc.tags = tags
    return this
  }

  type (mime /*: string */) /*: this */ {
    this.doc.class = mime.split('/')[0]
    this.doc.mime = mime
    return this
  }

  build () /*: Metadata */ {
    // Don't detect incompatibilities according to syncPath for test data, to
    // prevent environment related failures.
    metadata.assignPlatformIncompatibilities(this.doc, '')

    return _.cloneDeep(this.doc)
  }

  async create () /*: Promise<Metadata> */ {
    const { pouch } = this
    if (pouch == null) {
      throw new Error('Cannot create dir metadata without Pouch')
    }

    const doc = this.build()
    // Update doc until _rev matches the highest side
    const desiredRevNumber = Math.max(
      1,
      this.doc.sides.local || 0,
      this.doc.sides.remote || 0
    )
    let revNumber = 0
    while (revNumber < desiredRevNumber) {
      const { rev: newRev } = await pouch.db.put(doc)
      doc._rev = newRev
      revNumber = metadata.extractRevNumber(doc)
    }

    return doc
  }

  _assignId () /* void */ {
    metadata.assignId(this.doc)

    if (this.doc.moveFrom) {
      this.doc.moveFrom.moveTo = this.doc._id
    }
  }
}
