/* @flow */

const Promise = require('bluebird')

const checksumer = require('./checksumer')
const logger = require('../logger')

const LinuxObserver = require('./steps/linux_observer')
const InitialDiff = require('./steps/initial_diff')
const AddChecksum = require('./steps/add_checksum')
const Dispatch = require('./steps/dispatch')

const WinSource = require('./layers/win')
const ChecksumLayer = require('./layers/checksum')
const Dispatcher = require('./layers/dispatcher')

/*::
import type Pouch from '../pouch'
import type Prep from '../prep'
import type EventEmitter from 'events'
import type { Checksumer } from './checksumer'
*/

const log = logger({
  component: 'AtomWatcher'
})

module.exports = class AtomWatcher {
  /*::
  syncPath: string
  events: EventEmitter
  checksumer: Checksumer
  running: Promise<void>
  _runningResolve: ?Function
  _runningReject: ?Function
  source: WinSource
  */

  constructor (syncPath /*: string */, prep /*: Prep */, pouch /*: Pouch */, events /*: EventEmitter */) {
    this.syncPath = syncPath
    this.events = events
    this.checksumer = checksumer.init()

    if (process.platform === 'linux') {
      const linux = LinuxObserver(syncPath)
      const initialDiff = InitialDiff(linux)
      const checksum = AddChecksum(initialDiff)
      const dispatch = Dispatch(checksum)
      this.source = dispatch
    } else if (process.platform === 'win32') {
      // TODO add a layer to detect moves
      // TODO do we need a debounce layer (a port of awaitWriteFinish of chokidar)?
      const dispatcher = new Dispatcher(prep, pouch, events)
      const checksumer = new ChecksumLayer(dispatcher, this.checksumer)
      this.source = new WinSource(syncPath, checksumer)
    } else {
      throw new Error('The experimental watcher is not available on this platform')
    }
  }

  start () {
    log.debug('starting...')
    this.running = new Promise((resolve, reject) => {
      this._runningResolve = resolve
      this._runningReject = reject
    })
    this.source.start()
    return new Promise((resolve) => {
      this.events.on('initial-scan-done', resolve)
    })
  }

  async stop (force /*: ? bool */) /*: Promise<*> */ {
    if (this._runningResolve) {
      this._runningResolve()
      this._runningResolve = null
    }
    this.source.stop()
  }
}
