// TODO: Rename to cli/test/helpers/scenarios.js

const Promise = require('bluebird')
const fs = require('fs-extra')
const glob = require('glob')
const _ = require('lodash')
const path = require('path')

const metadata = require('../../src/metadata')

const { cozy } = require('./cozy')

const debug = process.env.DEBUG ? console.log : () => {}

const scenarioByPath = module.exports.scenarioByPath = scenarioPath => {
  const name = path.basename(path.dirname(scenarioPath))
  // $FlowFixMe
  const scenario = require(scenarioPath)
  scenario.name = name
  scenario.path = scenarioPath

  if (process.platform === 'win32' && scenario.expected && scenario.expected.prepCalls) {
    for (let prepCall of scenario.expected.prepCalls) {
      if (prepCall.src) {
        prepCall.src = prepCall.src.split('/').join('\\').toUpperCase()
        // @TODO why is src in maj
      }
      if (prepCall.path) prepCall.path = prepCall.path.split('/').join('\\')
      if (prepCall.dst) prepCall.dst = prepCall.dst.split('/').join('\\')
    }
  }

  return scenario
}

// TODO: Refactor to function
module.exports.scenarios =
  glob.sync(path.join(__dirname, '../scenarios/**/scenario.js'), {})
    .map(scenarioByPath)

module.exports.loadFSEventFiles = (scenario) => {
  const eventFiles = glob.sync(path.join(path.dirname(scenario.path), 'local', '*.json'))
  return eventFiles
    .map(f => {
      const name = path.basename(f)
      const events = fs.readJsonSync(f).map(e => {
        if (e.stats) {
          e.stats.mtime = new Date(e.stats.mtime)
          e.stats.ctime = new Date(e.stats.ctime)
        }
        if (name.indexOf('win32') !== -1 && process.platform !== 'win32') {
          e.path = e.path.replace(/\\/g, '/')
        }
        if (name.indexOf('win32') === -1 && process.platform === 'win32') {
          e.path = e.path.replace(/\//g, '\\')
        }
        return e
      })

      return {name, events}
    })
}

module.exports.loadRemoteChangesFiles = (scenario) => {
  const pattern = path.join(path.dirname(scenario.path), 'remote', '*.json')
  return glob.sync(pattern).map(f => ({
    name: path.basename(f),
    changes: fs.readJsonSync(f)
  }))
}

module.exports.init = async (scenario, pouch, abspath, relpathFix) => {
  debug('init')
  for (let {path: relpath, ino} of scenario.init) {
    debug(relpath)
    const isOutside = relpath.startsWith('../outside')
    let remoteParent
    if (!isOutside) {
      debug('retrieve remote parent...')
      const remoteParentPath = path.posix.join('/', path.posix.dirname(relpath))
      remoteParent = await cozy.files.statByPath(remoteParentPath)
    }
    const lastModifiedDate = new Date('2011-04-11T10:20:30Z')
    if (relpath.endsWith('/')) {
      relpath = _.trimEnd(relpath, '/') // XXX: Check in metadata.id?
      relpath = relpathFix(relpath)
      debug('create local dir...')
      await fs.ensureDir(abspath(relpath))
      const doc = {
        _id: metadata.id(relpath),
        docType: 'folder',
        updated_at: lastModifiedDate,
        path: relpath,
        ino,
        tags: [],
        sides: {local: 1, remote: 1}
      }
      if (!isOutside) {
        debug('create remote dir...')
        const remoteDir = await cozy.files.createDirectory({
          name: path.basename(relpath),
          dirID: remoteParent._id,
          lastModifiedDate
        })
        doc.remote = _.pick(remoteDir, ['_id', '_rev'])
      }
      debug('create dir metadata...')
      await pouch.put(doc)
    } else {
      relpath = relpathFix(relpath)
      const content = 'foo'
      const md5sum = 'rL0Y20zC+Fzt72VPzMSk2A=='
      debug('create local file...')
      await fs.outputFile(abspath(relpath), content)
      const doc = {
        _id: metadata.id(relpath),
        md5sum,
        class: 'text',
        docType: 'file',
        executable: false,
        updated_at: lastModifiedDate,
        mime: 'text/plain',
        path: relpath,
        ino,
        size: 0,
        tags: [],
        sides: {local: 1, remote: 1}
      }
      if (!isOutside) {
        debug('create remote file...')
        const remoteFile = await cozy.files.create(content, {
          name: path.basename(relpath),
          dirID: remoteParent._id,
          checksum: md5sum,
          contentType: 'text/plain',
          lastModifiedDate
        })
        doc.remote = _.pick(remoteFile, ['_id', '_rev'])
      }
      debug('create file metadata...')
      await pouch.put(doc)
    } // if relpath ...
  } // for (... of scenario.init)
}

module.exports.runActions = (scenario, abspath) => {
  debug(`actions:`)
  return Promise.each(scenario.actions, action => {
    switch (action.type) {
      case 'mkdir':
        debug('- mkdir', action.path)
        return fs.ensureDir(abspath(action.path))

      case '>':
        debug('- >', action.path)
        return fs.outputFile(abspath(action.path), 'whatever')

      case '>>':
        debug('- >>', action.path)
        return fs.appendFile(abspath(action.path), ' blah')

      case 'rm':
        debug('- rm', action.path)
        return fs.remove(abspath(action.path))

      case 'mv':
        debug('- mv', action.src, action.dst)
        return fs.rename(abspath(action.src), abspath(action.dst))

      case 'wait':
        debug('- wait', action.ms)
        return Promise.delay(action.ms)

      default:
        return Promise.reject(new Error(`Unknown action ${action.type} for scenario ${scenario.name}`))
    }
  })
}
