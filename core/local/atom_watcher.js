/* @flow */

const Promise = require('bluebird')

const checksumer = require('./checksumer')
const logger = require('../logger')

const LinuxProducer = require('./steps/linux_producer')
const WinProducer = require('./steps/win_producer')
const addInfos = require('./steps/add_infos')
const filterIgnored = require('./steps/filter_ignored')
const winDetectMove = require('./steps/win_detect_move')
const scanFolder = require('./steps/scan_folder')
const awaitWriteFinish = require('./steps/await_write_finish')
const initialDiff = require('./steps/initial_diff')
const addChecksum = require('./steps/add_checksum')
const incompleteFixer = require('./steps/incomplete_fixer')
const dispatch = require('./steps/dispatch')

/*::
import type Pouch from '../pouch'
import type Prep from '../prep'
import type EventEmitter from 'events'
import type { Ignore } from '../ignore'
import type { Checksumer } from './checksumer'
import type { Producer } from './steps/producer'
*/

const log = logger({
  component: 'AtomWatcher'
})

module.exports = class AtomWatcher {
  /*::
  syncPath: string
  prep: Prep
  pouch: Pouch
  events: EventEmitter
  ignore: Ignore
  checksumer: Checksumer
  producer: Producer
  running: Promise<void>
  _runningResolve: ?Function
  _runningReject: ?Function
  dispatchBatch: ?Function
  */

  constructor (syncPath /*: string */, prep /*: Prep */, pouch /*: Pouch */, events /*: EventEmitter */, ignore /*: Ignore */) {
    this.syncPath = syncPath
    this.prep = prep
    this.pouch = pouch
    this.events = events
    this.ignore = ignore
    this.checksumer = checksumer.init()

    // Here, we build a chain of steps. Each step can be seen as an actor that
    // communicates with the next one via a buffer. The first step is called
    // the producer: even if the chain is ready at the end of this constructor,
    // the producer won't start pushing batches of events until it is started.
    let steps
    if (process.platform === 'linux') {
      this.producer = new LinuxProducer(this)
      steps = [addInfos, filterIgnored, scanFolder,
        awaitWriteFinish, initialDiff, addChecksum, incompleteFixer]
    } else if (process.platform === 'win32') {
      this.producer = new WinProducer(this)
      steps = [addInfos, filterIgnored, winDetectMove, scanFolder,
        awaitWriteFinish, initialDiff, addChecksum, incompleteFixer]
    } else {
      throw new Error('The experimental watcher is not available on this platform')
    }
    let buffer = steps.reduce((buf, step) => step(buf, this), this.producer.buffer)
    dispatch(buffer, this)
  }

  start () {
    log.debug('starting...')
    this.running = new Promise((resolve, reject) => {
      this._runningResolve = resolve
      this._runningReject = reject
    })
    this.events.emit('local-start')
    this.producer.start()
    const scanDone = new Promise((resolve) => {
      this.events.on('initial-scan-done', resolve)
    })
    scanDone.then(async () => {
      let target = -1
      try {
        target = (await this.pouch.db.changes({limit: 1, descending: true})).last_seq
      } catch (err) { /* ignore err */ }
      this.events.emit('sync-target', target)
      this.events.emit('local-end')
    })
    return scanDone
  }

  async stop (force /*: ? bool */) /*: Promise<*> */ {
    log.debug('stopping...')
    if (this._runningResolve) {
      this._runningResolve()
      this._runningResolve = null
    }
    this.producer.stop()
  }
}
