const Promise = require('bluebird')
const chokidar = require('chokidar')
const EventEmitter = require('events')
const fse = require('fs-extra')
const _ = require('lodash')
const path = require('path')
const sinon = require('sinon')

const Config = require('../../core/config')
const AtomWatcher = require('../../core/local/atom_watcher')
const fixturesHelpers = require('../../test/support/helpers/scenarios')

const cliDir = path.resolve(path.join(__dirname, '..', '..'))
const syncPath = path.join(cliDir, 'tmp', 'local_watcher', 'synced_dir')
const outsidePath = path.join(cliDir, 'tmp', 'local_watcher', 'outside')
const abspath = (relpath) => path.join(syncPath, relpath.replace(/\//g, path.sep))
const chokidarOptions = {
  cwd: syncPath,
  ignored: /(^|[\/\\])\.system-tmp-cozy-drive/, // eslint-disable-line no-useless-escape
  followSymlinks: false,
  alwaysStat: true,
  usePolling: (process.platform === 'win32'),
  atomic: true,
  awaitWriteFinish: {
    pollInterval: 200,
    stabilityThreshold: 1000
  },
  interval: 1000,
  binaryInterval: 2000
}

const DONE_FILE = '.done'

const mapInode = {}

const debug = process.env.DEBUG != null ? console.log : () => {}

const setupInitialState = (scenario) => {
  if (scenario.init == null) return
  debug('[init]')
  return Promise.each(scenario.init, (opts) => {
    let {ino, path: relpath} = opts
    if (relpath.endsWith('/')) {
      debug('- mkdir', relpath)
      return fse.ensureDir(abspath(relpath))
             .then(() => fse.stat(abspath(relpath)))
             .then(stats => { mapInode[stats.ino] = ino })
    } else {
      debug('- >', relpath)
      return fse.outputFile(abspath(relpath), 'whatever')
             .then(() => fse.stat(abspath(relpath)))
             .then(stats => { mapInode[stats.ino] = ino })
    }
  })
}

const buildFSEvent = (type, relpath, stats) => {
  const event = {type, path: relpath}
  if (stats != null) event.stats = _.pick(stats, ['ino', 'size', 'mtime', 'ctime'])
  return event
}

const triggerDone = () => {
  return fse.outputFile(path.join(syncPath, DONE_FILE), '')
}

const isDone = (relpath) => {
  return relpath === DONE_FILE
}

const saveFSEventsToFile = (scenario, events, subdir = 'local') => {
  const json = JSON.stringify(events, null, 2)
  const eventsFile = scenario.path
    .replace(/scenario\.js/, path.join(subdir, `${process.platform}.json`))

  return fse.outputFile(eventsFile, json)
    .then(() => path.basename(eventsFile))
}

const logFSEvents = (events) => {
  if (process.env.DEBUG == null) return
  console.log('events:')
  for (let e of events) {
    console.log('-', e.type, e.path, `[${e.stats ? e.stats.ino : 'N/A'}]`)
  }
}

const runAndRecordChokidarEvents = (scenario) => {
  return new Promise((resolve, reject) => {
    const watcher = chokidar.watch('.', chokidarOptions)
    const cleanCallback = cb => function () {
      watcher.close()
      cb.apply(null, arguments)
    }
    resolve = cleanCallback(resolve)
    reject = cleanCallback(reject)
    const events = []
    let record = false

    for (let eventType of ['add', 'addDir', 'change', 'unlink', 'unlinkDir']) {
      watcher.on(eventType, (relpath, stats) => {
        if (record) {
          if (isDone(relpath)) {
            logFSEvents(events)
            return saveFSEventsToFile(scenario, events)
              .then(resolve)
              .catch(reject)
          } else {
            if (stats != null && mapInode[stats.ino]) {
              stats.ino = mapInode[stats.ino]
            }
            events.push(buildFSEvent(eventType, relpath, stats))
          }
        }
      })
    }

    watcher.on('ready', () => {
      record = true
      fixturesHelpers.runActions(scenario, abspath)
        .delay(1000)
        .then(triggerDone)
        .catch(reject)
    })

    watcher.on('error', reject)
  })
}

const runAndRecordAtomEvents = async scenario => {
  const prep = {
    addFileAsync: sinon.stub().resolves(),
    updateFileAsync: sinon.stub().resolves(),
    putFolderAsync: sinon.stub().resolves(),
    moveFileAsync: sinon.stub().resolves(),
    moveFolderAsync: sinon.stub().resolves(),
    trashFileAsync: sinon.stub().resolves(),
    trashFolderAsync: sinon.stub().resolves(),
    deleteFileAsync: sinon.stub().resolves(),
    deleteFolderAsync: sinon.stub().resolves()
  }
  const pouch = {byRecursivePathAsync: sinon.stub().resolves([])}
  const events = new EventEmitter()
  const ignore = {isIgnored: whatever => false}
  const capturedBatches = []
  const watcher = new AtomWatcher(syncPath, prep, pouch, events, ignore)

  try {
    await watcher.start()
    const { buffer } = watcher.producer
    const actualPush = buffer.push
    buffer.push = batch => {
      capturedBatches.push(_.cloneDeep(batch))
      actualPush.call(buffer, batch)
    }
    await fixturesHelpers.runActions(scenario, abspath)
    await Promise.delay(1000)
    await saveFSEventsToFile(scenario, capturedBatches, 'atom')
  } finally {
    await watcher.stop()
  }
}

const runAndRecordFSEvents = Config.watcherType() === 'atom'
  ? runAndRecordAtomEvents
  : runAndRecordChokidarEvents

const captureScenario = (scenario) => {
  return fse.emptyDir(syncPath)
    .then(() => fse.emptyDir(outsidePath))
    .then(() => setupInitialState(scenario))
    .then(() => runAndRecordFSEvents(scenario))
}

module.exports = {
  name: 'local',
  setupInitialState,
  syncPath,
  mapInode,
  captureScenario
}
