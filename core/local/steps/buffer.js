/* @flow */

const Promise = require('bluebird')

/*::
import type { AtomWatcherEvent, Batch } from './event'
*/

// Buffer is a data structure for propagating batches of events from a FS
// watcher to the Pouch database, via several steps. It's expected that we have
// only one class/function that pushes in the buffer, and only one
// class/function that takes batches from the buffer.
//
// FIXME: Rename Buffer to prevent confusion with the built-in type.
module.exports = class Buffer {
  /*::
  _resolve: ?Promise<Batch>
  _buffer: Array<Batch>
  */
  constructor () {
    this._resolve = null
    this._buffer = []
  }

  push (batch /*: Batch */) /*: void */ {
    if (batch.length === 0) return

    if (this._resolve) {
      this._resolve(batch)
      this._resolve = null
    } else {
      this._buffer.push(batch)
    }
  }

  pop () /*: Promise<Batch> */ {
    if (this._buffer.length > 0) {
      const batch = this._buffer.shift()
      return Promise.resolve(batch)
    }
    return new Promise((resolve) => {
      this._resolve = resolve
    })
  }

  async doMap (fn /*: (Batch) => Batch */, buffer /*: Buffer */) /*: Promise<void> */ {
    while (true) {
      const batch = fn(await this.pop())
      buffer.push(batch)
    }
  }

  map (fn /*: (Batch) => Batch */) /*: Buffer */ {
    const buffer = new Buffer()
    this.doMap(fn, buffer)
    return buffer
  }

  async doAsyncMap (fn /*: (Batch) => Promise<Batch> */, buffer /*: Buffer */) /*: Promise<void> */ {
    while (true) {
      const batch = await this.pop()
      const after = await fn(batch)
      buffer.push(after)
    }
  }

  asyncMap (fn /*: (Batch) => Promise<Batch> */) /*: Buffer */ {
    const buffer = new Buffer()
    this.doAsyncMap(fn, buffer)
    return buffer
  }
}
