/** Test data builders. Plain functions or Object mother patterns.
 *
 * @module test/support/builders
 * @flow
 */

const path = require('path')

const { ROOT_DIR_ID } = require('../../../core/remote/constants')

const DirMetadataBuilder = require('./metadata/dir')
const FileMetadataBuilder = require('./metadata/file')
const RemoteDirBuilder = require('./remote/dir')
const RemoteFileBuilder = require('./remote/file')
const StreamBuilder = require('./stream')
const AtomEventBuilder = require('./atom_event')

/*::
import type { Cozy } from 'cozy-client-js'
import type { Metadata } from '../../../core/metadata'
import type { Pouch } from '../../../core/pouch'
import type { Warning } from '../../../core/remote/warning'
import type { RemoteDoc } from '../../../core/remote/document'
import type { AtomEvent } from '../../../core/local/atom/event'
*/

// Test data builders facade.
//
//     builders.metafile()...
//     builders.remoteDir()...
//     builders.stream()...
//
module.exports = class Builders {
  /*::
  cozy: ?Cozy
  pouch: ?Pouch
  */

  constructor({ cozy, pouch } /*: {cozy?: Cozy, pouch?: Pouch} */ = {}) {
    this.cozy = cozy
    this.pouch = pouch
  }

  metadata(old /*: ?Metadata */) /*: DirMetadataBuilder|FileMetadataBuilder */ {
    return this.metadir(old)
  }

  metadir(old /*: ?Metadata */) /*: DirMetadataBuilder */ {
    return new DirMetadataBuilder(this.pouch, old)
  }

  metafile(old /*: ?Metadata */) /*: FileMetadataBuilder */ {
    return new FileMetadataBuilder(this.pouch, old)
  }

  remoteDir(old /*: ?RemoteDoc */) /*: RemoteDirBuilder */ {
    return new RemoteDirBuilder(this.cozy, old)
  }

  remoteFile(old /*: ?RemoteDoc */) /*: RemoteFileBuilder */ {
    return new RemoteFileBuilder(this.cozy, old)
  }

  buildRemoteTree(
    paths /*: Array<string|[string, number]> */
  ) /*: { [string]: RemoteDoc } */ {
    const remoteDocsByPath = {}
    for (const p of paths) {
      let docPath, shortRev
      if (typeof p === 'string') {
        docPath = p
        shortRev = 1
      } else {
        docPath = p[0]
        shortRev = p[1]
      }
      const name = path.posix.basename(docPath)
      const parentPath = path.posix.dirname(docPath)
      const parentDir = remoteDocsByPath[parentPath + '/'] || {
        _id: ROOT_DIR_ID,
        path: '/'
      }

      if (docPath.endsWith('/')) {
        remoteDocsByPath[docPath] = this.remoteDir()
          .name(name)
          .inDir(parentDir)
          .shortRev(shortRev)
          .build()
      } else {
        remoteDocsByPath[docPath] = this.remoteFile()
          .name(name)
          .inDir(parentDir)
          .shortRev(shortRev)
          .build()
      }
    }

    return remoteDocsByPath
  }

  remoteWarnings() /*: Warning[] */ {
    return [
      {
        error: 'tos-updated',
        title: 'TOS Updated',
        detail: 'TOS have been updated',
        links: {
          self: 'https://manager.cozycloud.cc/cozy/tos?domain=...'
        }
      }
    ]
  }

  stream() /*: StreamBuilder */ {
    return new StreamBuilder()
  }

  event(old /*: ?AtomEvent */) /*: AtomEventBuilder */ {
    return new AtomEventBuilder(old)
  }

  nonEmptyBatch(batchNumber /*: number */ = 1) /*: AtomEvent[] */ {
    return [
      this.event()
        .action('created')
        .kind('file')
        .path(`file-from-batch-${batchNumber}`)
        .build(),
      this.event()
        .action('deleted')
        .kind('directory')
        .path(`dir-from-batch-${batchNumber}`)
        .build()
    ]
  }
}
