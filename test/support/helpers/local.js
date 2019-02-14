/* @flow */

const autoBind = require('auto-bind')
const Promise = require('bluebird')
const fse = require('fs-extra')
const _ = require('lodash')
const path = require('path')
const rimraf = require('rimraf')

const conflictHelpers = require('./conflict')
const { ContextDir } = require('./context_dir')

const { TMP_DIR_NAME } = require('../../../core/local/constants')

const rimrafAsync = Promise.promisify(rimraf)

/*::
import type Local from '../../../core/local'
import type { ChokidarEvent } from '../../../core/local/chokidar_event'
import type { Batch } from '../../../core/local/steps/event'
*/

class LocalTestHelpers {
  /*::
  local: Local
  syncDir: ContextDir
  trashDir: ContextDir
  */

  constructor (local /*: Local */) {
    this.local = local
    this.syncDir = new ContextDir(local.syncPath)
    autoBind(this)
  }

  get syncPath () /*: string */ {
    return path.normalize(this.local.syncPath)
  }

  get trashPath () /*: string */ {
    return path.join(this.local.tmpPath, '.test-trash')
  }

  async clean () {
    for (const pattern of ['*', '.*']) {
      await rimrafAsync(path.join(this.syncPath, pattern))
    }
  }

  async trashFunc (paths /*: string[] */) /*: Promise<void> */ {
    for (const src of paths) {
      const dst = path.join(this.trashPath, path.basename(src))
      try {
        await fse.rename(src, dst)
      } catch (err) {
        throw err
      }
    }
  }

  async setupTrash () {
    await fse.emptyDir(this.trashPath)
    this.trashDir = new ContextDir(this.trashPath)
    this.local._trash = this.trashFunc
  }

  async tree (opts /*: {ellipsize: boolean} */ = {ellipsize: true}) /*: Promise<string[]> */ {
    let trashContents
    try {
      trashContents = await this.trashDir.tree()
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      throw new Error(
        'You must call and await helpers.local.setupTrash() (e.g. in a ' +
        'beforeEach block) before calling helpers.local.tree() in a test'
      )
    }
    const ellipsizeDate = opts.ellipsize ? conflictHelpers.ellipsizeDate : _.identity
    return trashContents
      .map(relPath => path.posix.join('/Trash', relPath))
      .concat(await this.syncDir.tree())
      .map(ellipsizeDate)
      .filter(relpath => !relpath.match(TMP_DIR_NAME))
      .sort()
  }

  async scan () {
    await this.local.watcher.start()
    await this.local.watcher.stop()
  }

  async treeWithoutTrash () {
    return (await this.tree())
      .filter(p => !p.startsWith('/Trash/'))
  }

  async simulateEvents (events /*: ChokidarEvent[] */) {
    // $FlowFixMe
    return this.local.watcher.onFlush(events)
  }

  simulateAtomEvents (batches /*: Batch[] */) {
    for (const batch of batches) {
      // $FlowFixMe
      this.local.watcher.producer.buffer.push(batch)
    }
  }

  async readFile (path /*: string */) /*: Promise<string> */ {
    return this.syncDir.readFile(path)
  }
}

module.exports = {
  LocalTestHelpers
}
