const Promise = require('bluebird')
const fse = require('fs-extra')
const glob = require('glob')
const _ = require('lodash')
const path = require('path')
const crypto = require('crypto')
const mergedirs = require('merge-dirs').default

const metadata = require('../../../core/metadata')

const { cozy } = require('./cozy')

const debug = process.env.TESTDEBUG ? console.log : () => {}

const disabledExtension = '.DISABLED'

const scenariosDir = path.resolve(__dirname, '../../scenarios')

const scenarioByPath = module.exports.scenarioByPath = scenarioPath => {
  // $FlowFixMe
  const scenario = require(scenarioPath)
  scenario.name = path.dirname(path.normalize(scenarioPath))
    .replace(scenariosDir + path.sep, '')
    .replace(/\\/g, '/')
  scenario.path = scenarioPath
  scenario.disabled = scenarioPath.endsWith(disabledExtension) && 'scenario disabled'

  if (process.platform === 'win32' && scenario.expected && scenario.expected.prepCalls) {
    for (let prepCall of scenario.expected.prepCalls) {
      if (prepCall.src) {
        prepCall.src = prepCall.src.split('/').join('\\')
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
  glob.sync(path.join(scenariosDir, '**/scenario.js*'), {})
    .map(scenarioByPath)

if (module.exports.scenarios.length === 0) {
  throw new Error(`No scenario found! Please check scenariosDir: ${scenariosDir}`)
}

module.exports.loadFSEventFiles = (scenario) => {
  const eventFiles = glob.sync(path.join(path.dirname(scenario.path), 'local', '*.json*'))
  const disabledEventsFile = (name) => {
    if (process.platform === 'win32' && name.indexOf('win32') === -1) {
      return 'darwin/linux test'
    } else if (name.endsWith(disabledExtension)) {
      return 'disabled case'
    }
  }
  return eventFiles
    .map(f => {
      const name = path.basename(f)
      const disabled = scenario.disabled || disabledEventsFile(name)
      const events = fse.readJsonSync(f).map(e => {
        if (e.stats) {
          e.stats.mtime = new Date(e.stats.mtime)
          e.stats.ctime = new Date(e.stats.ctime)
        }
        if (name.indexOf('win32') !== -1 && process.platform !== 'win32') {
          e.path = e.path && e.path.replace(/\\/g, '/')
        }
        if (name.indexOf('win32') === -1 && process.platform === 'win32') {
          e.path = e.path && e.path.replace(/\//g, '\\')
        }
        return e
      })

      return {name, events, disabled}
    })
}

module.exports.loadAtomCaptures = scenario => {
  const eventFiles = glob.sync(path.join(path.dirname(scenario.path), 'atom', '*.json*'))
  return eventFiles
    .map(f => {
      const name = path.basename(f)
      const disabled = scenario.disabled
      const batches = fse.readJsonSync(f)
        .map(batch =>
          batch.map(event =>
            event.stats
              ? _.defaultsDeep({
                stats: {
                  atime: new Date(event.stats.atime),
                  mtime: new Date(event.stats.mtime),
                  ctime: new Date(event.stats.ctime),
                  birthtime: new Date(event.stats.birthtime)
                }
              }, event)
              : event
          )
        )

      return {name, batches, disabled}
    })
}

module.exports.loadRemoteChangesFiles = (scenario) => {
  const pattern = path.join(path.dirname(scenario.path), 'remote', '*.json*')

  return glob.sync(pattern).map(f => {
    const name = path.basename(f)
    const disabled = scenario.disabled || f.endsWith(disabledExtension)
    const changes = fse.readJsonSync(f)
    return {name, disabled, changes}
  })
}

module.exports.init = async (scenario, pouch, abspath, relpathFix, trueino) => {
  debug('[init]')
  const remoteDocsToTrash = []
  for (let {path: relpath, ino, trashed, content} of scenario.init) {
    debug(relpath)
    const isOutside = relpath.startsWith('../outside')
    let remoteParent
    if (!isOutside) {
      const remoteParentPath = path.posix.join('/', path.posix.dirname(relpath))
      debug(`- retrieve remote parent: ${remoteParentPath}`)
      remoteParent = await cozy.files.statByPath(remoteParentPath)
    }
    const remoteName = path.posix.basename(relpath)
    const remotePath = path.posix.join(_.get(remoteParent, 'attributes.path', ''), remoteName)
    const localPath = relpathFix(_.trimEnd(relpath, '/'))
    const lastModifiedDate = new Date('2011-04-11T10:20:30Z')
    if (relpath.endsWith('/')) {
      if (!trashed) {
        debug(`- create local dir: ${localPath}`)
        await fse.ensureDir(abspath(localPath))
        if (trueino) ino = (await fse.stat(abspath(localPath))).ino
      }

      const doc = {
        _id: metadata.id(localPath),
        docType: 'folder',
        updated_at: lastModifiedDate,
        path: localPath,
        ino,
        tags: [],
        sides: {local: 1, remote: 1}
      }

      if (!isOutside) {
        debug(`- create${trashed ? ' and trash' : ''} remote dir: ${remotePath}`)
        const remoteDir = await cozy.files.createDirectory({
          name: remoteName,
          dirID: remoteParent._id,
          lastModifiedDate
        })
        doc.remote = _.pick(remoteDir, ['_id', '_rev'])
        if (trashed) remoteDocsToTrash.push(remoteDir)
        else {
          debug(`- create dir metadata: ${doc._id}`)
          await pouch.put(doc)
        }
      }
    } else {
      let md5sum
      if (!content) {
        content = 'foo'
        md5sum = 'rL0Y20zC+Fzt72VPzMSk2A=='
      } else {
        md5sum = crypto.createHash('md5').update(content).digest().toString('base64')
      }

      if (!trashed) {
        debug(`- create local file: ${localPath}`)
        await fse.outputFile(abspath(localPath), content)
        if (trueino) ino = (await fse.stat(abspath(localPath))).ino
      }

      const doc = {
        _id: metadata.id(localPath),
        md5sum,
        class: 'text',
        docType: 'file',
        executable: false,
        updated_at: lastModifiedDate,
        mime: 'text/plain',
        path: localPath,
        ino,
        size: content.length,
        tags: [],
        sides: {local: 1, remote: 1}
      }
      if (!isOutside) {
        debug(`- create${trashed ? ' and trash' : ''} remote file: ${remotePath}`)
        const remoteFile = await cozy.files.create(content, {
          name: remoteName,
          dirID: remoteParent._id,
          checksum: md5sum,
          contentType: 'text/plain',
          lastModifiedDate
        })
        doc.remote = _.pick(remoteFile, ['_id', '_rev'])
        if (trashed) remoteDocsToTrash.push(remoteFile)
        else {
          debug(`- create file metadata: ${doc._id}`)
          await pouch.put(doc)
        }
      }
    } // if relpath ...
  } // for (... of scenario.init)
  for (let remoteDoc of remoteDocsToTrash) {
    await cozy.files.trashById(remoteDoc._id)
  }
}

module.exports.runActions = (scenario, abspath, opts /*: {skipWait?: true} */ = {}) => {
  debug('[actions]')
  return Promise.each(scenario.actions, action => {
    switch (action.type) {
      case 'mkdir':
        debug('- mkdir', action.path)
        return fse.ensureDir(abspath(action.path))

      case 'create_file':
        debug('- create_file', action.path)
        return fse.outputFile(abspath(action.path), 'whatever')

      case 'update_file':
        debug('- update_file', action.path)
        return fse.writeFile(abspath(action.path), action.content)

      case 'trash':
        debug('- trash', action.path)
        return fse.remove(abspath(action.path))

      case 'delete':
        debug('- delete', action.path)
        return fse.remove(abspath(action.path))

      case 'mv':
        debug('- mv', action.force ? 'force' : '', action.src, action.dst)
        if (action.merge) {
          // FIXME: Does this preserve inode ?
          mergedirs(abspath(action.src), abspath(action.dst), 'overwrite')
          return fse.remove(abspath(action.src))
        } else if (action.force) {
          return fse.move(abspath(action.src), abspath(action.dst), {overwrite: true})
        } else {
          return fse.rename(abspath(action.src), abspath(action.dst))
        }

      case 'wait':
        if (opts.skipWait) return Promise.resolve()
        debug('- wait', action.ms)
        return Promise.delay(action.ms)

      default:
        return Promise.reject(new Error(`Unknown action ${action.type} for scenario ${scenario.name}`))
    }
  })
}
