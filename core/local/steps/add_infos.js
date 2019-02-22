/* @flow */

const path = require('path')
const uuidv4 = require('uuid/v4')

const { id } = require('../../metadata')
const stater = require('../stater')
const logger = require('../../logger')
const log = logger({
  component: 'addInfos'
})

/*::
import type Buffer from './buffer'
*/

module.exports = {
  loop
}

// This step adds some basic informations about events: _id, docType and stats.
function loop (buffer /*: Buffer */, opts /*: { syncPath: string } */) /*: Buffer */ {
  return buffer.asyncMap(async (events) => {
    const batch = []
    for (const event of events) {
      if (event.kind === 'symlink') {
        log.error({event}, 'Symlinks are not supported')
        // TODO display an error in the UI
        continue
      }
      try {
        event.uuid = uuidv4()
        if (event.action !== 'initial-scan-done') {
          event._id = id(event.path)
          if (['created', 'modified', 'renamed'].includes(event.action)) {
            event.stats = await stater.stat(path.join(opts.syncPath, event.path))
          }
          if (event.stats) { // created, modified, renamed, scan
            event.kind = stater.kind(event.stats)
          } else { // deleted
            // If kind is unknown, we say it's a file arbitrary
            event.kind = event.kind === 'directory' ? 'directory' : 'file'
          }
          log.debug({uuid: event.uuid, path: event.path, action: event.action}, 'infos')
        }
      } catch (err) {
        log.info({err, event}, 'Cannot get infos')
        event.incomplete = true
      }
      batch.push(event)
    }
    return batch
  })
}
