/* @flow */

const { id } = require('../../metadata')
const Buffer = require('./buffer')

/*::
import type Pouch from '../../pouch'
*/

// TODO add unit tests

// Some files and directories can have been deleted while cozy-desktop was
// stopped. So, at the end of the initial scan, we have to to a diff between
// what was in pouchdb and the events from the local watcher to find what was
// deleted.
async function initialDiff (buffer, out, pouch) {
  // Using inode/fileId is more robust that using path or id for detecting
  // which files/folders have been deleted, as it is stable even if the
  // file/folder has been moved or renamed
  const byInode = new Map()
  const docs = await pouch.byRecursivePathAsync('')
  for (const doc of docs) {
    if (!doc.ino) {
      // Ignore files/dirs created on the remote and never synchronized
      continue
    }
    const kind = doc.docType === 'file' ? 'file' : 'directory'
    byInode.set(doc.fileid || doc.ino, { path: doc.path, kind: kind })
  }
  let done = false

  while (true) {
    const events = await buffer.pop()
    if (done) {
      out.push(events)
      continue
    }

    const batch = []
    for (const event of events) {
      if (event.incomplete) {
        batch.push(event)
        continue
      }

      // Detect if the file was moved while the client was stopped
      if (['created', 'scan'].includes(event.action)) {
        let was
        if (event.stats.fileid) {
          was = byInode.get(event.stats.fileid)
        }
        if (!was) {
          was = byInode.get(event.stats.ino)
        }
        if (was && was.path !== event.path) {
          if (was.kind === event.kind) {
            // TODO for a directory, maybe we should check the children
            event.action = 'renamed'
            event.oldPath = was.path
          } else {
            // On linux, the inodes can have been reused: a file was deleted
            // and a directory created just after while the client was stopped
            // for example.
            batch.push({
              action: 'deleted',
              kind: was.kind,
              _id: id(was.path),
              path: was.path
            })
          }
        }
      }

      if (['created', 'modified', 'renamed', 'scan'].includes(event.action)) {
        if (event.stats.fileid) {
          byInode.delete(event.stats.fileid)
        }
        byInode.delete(event.stats.ino)
      } else if (event.action === 'initial-scan-done') {
        // Emit deleted events for all the remaining files/dirs
        for (const [, doc] of byInode) {
          batch.push({
            action: 'deleted',
            kind: doc.kind,
            _id: id(doc.path),
            path: doc.path
          })
        }
        byInode.clear()
        done = true
      }
      batch.push(event)
    }

    out.push(batch)
  }
}

module.exports = function (buffer /*: Buffer */, opts /*: { pouch: Pouch } */) /*: Buffer */ {
  const out = new Buffer()
  initialDiff(buffer, out, opts.pouch)
  return out
}
