/* @flow */
/* eslint-env mocha */

const should = require('should')
const OldCozyClient = require('cozy-client-js').Client

const configHelpers = require('../support/helpers/config')
const cozyHelpers = require('../support/helpers/cozy')
const pouchHelpers = require('../support/helpers/pouch')
const TestHelpers = require('../support/helpers')
const Builders = require('../support/builders')
const passphrase = require('../support/helpers/passphrase')

const pkg = require('../../package.json')
const automatedRegistration = require('../../dev/remote/automated_registration')
const {
  FILES_DOCTYPE,
  OAUTH_CLIENTS_DOCTYPE
} = require('../../core/remote/constants')
const logger = require('../../core/utils/logger')

const log = new logger({
  component: 'TEST'
})

const path = remoteDoc =>
  remoteDoc.type === 'directory'
    ? `${remoteDoc.path.slice(1)}/`
    : remoteDoc.path.slice(1)

describe('Differential synchronization', () => {
  let helpers, builders, cozy, files

  before(configHelpers.createConfig)
  before('register client', async function() {
    const registration = automatedRegistration(
      this.config.cozyUrl,
      passphrase,
      this.config
    )
    await registration.process(pkg)
  })
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)

  afterEach(() => helpers.local.clean())
  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  beforeEach(async function() {
    this.cozy = cozy = new OldCozyClient({
      cozyURL: this.config.cozyUrl,
      oauth: {
        clientParams: this.config.client,
        storage: this.config
      }
    })

    helpers = TestHelpers.init(this)
    helpers.local.setupTrash()
    await helpers.remote.ignorePreviousChanges()

    await helpers.remote.pullChanges()
    await helpers.syncAll()

    helpers.spyPouch()

    builders = new Builders({ cozy })
  })

  let remoteDir, remoteFile
  beforeEach(async function() {
    remoteDir = await builders
      .remoteDir()
      .name('Photos')
      .create()
    remoteFile = await builders
      .remoteFile()
      .inDir(remoteDir)
      .name('IMG_001.jpg')
      .data('image')
      .create()

    // FIXME: This needs to be called after a first request to the remote Cozy.
    // Otherwise the client does not have the expected OAuth credentials.
    files = (await cozyHelpers.newClient(cozy)).collection(FILES_DOCTYPE)
  })

  describe('when a folder is excluded from synchronization', () => {
    let excludedDir, oauthClient
    beforeEach(async function() {
      excludedDir = { _id: remoteDir._id, _type: FILES_DOCTYPE }
      oauthClient = {
        _id: this.config.client.clientID,
        _type: OAUTH_CLIENTS_DOCTYPE
      }
    })

    context('and the folder was never synced', () => {
      it('does not propagate it or its content to the local filesystem', async function() {
        await files.addNotSynchronizedDirectories(oauthClient, [excludedDir])

        await helpers.pullAndSyncAll()
        should(await helpers.remote.treeWithoutTrash()).deepEqual([
          path(remoteDir),
          path(remoteFile)
        ])
        should(await helpers.local.treeWithoutTrash()).deepEqual([])
      })
    })

    context('and the folder was previously synced', () => {
      beforeEach(async function() {
        await helpers.pullAndSyncAll()
      })

      it('propagates its deletion to the local filesystem', async function() {
        should(await helpers.local.treeWithoutTrash()).deepEqual([
          path(remoteDir),
          path(remoteFile)
        ])

        await files.addNotSynchronizedDirectories(oauthClient, [excludedDir])

        await helpers.pullAndSyncAll()
        should(await helpers.remote.treeWithoutTrash()).deepEqual([
          path(remoteDir),
          path(remoteFile)
        ])
        should(await helpers.local.treeWithoutTrash()).deepEqual([])
      })
    })
  })

  describe('when a folder is re-included into synchronization', () => {
    let excludedDir, oauthClient
    beforeEach(async function() {
      excludedDir = { _id: remoteDir._id, _type: FILES_DOCTYPE }
      oauthClient = {
        _id: this.config.client.clientID,
        _type: OAUTH_CLIENTS_DOCTYPE
      }

      await helpers.pullAndSyncAll()

      await files.addNotSynchronizedDirectories(oauthClient, [excludedDir])

      await helpers.pullAndSyncAll()
    })

    it('propagates its addition and that of its content to the local filesystem', async function() {
      should(await helpers.local.treeWithoutTrash()).deepEqual([])

      await files.removeNotSynchronizedDirectories(oauthClient, [excludedDir])

      await helpers.pullAndSyncAll()
      should(await helpers.remote.treeWithoutTrash()).deepEqual([
        path(remoteDir),
        path(remoteFile)
      ])
      should(await helpers.local.treeWithoutTrash()).deepEqual([
        path(remoteDir),
        path(remoteFile)
      ])
    })
  })

  describe.only('when a folder is created locally with the same path as an excluded folder', () => {
    let excludedDir, oauthClient
    beforeEach(async function() {
      excludedDir = { _id: remoteDir._id, _type: FILES_DOCTYPE }
      oauthClient = {
        _id: this.config.client.clientID,
        _type: OAUTH_CLIENTS_DOCTYPE
      }
    })

    context('and the folder was never synced', () => {
      it('creates a local conflict', async function() {
        await files.addNotSynchronizedDirectories(oauthClient, [excludedDir])

        await helpers.pullAndSyncAll()
        should(await helpers.local.treeWithoutTrash()).deepEqual([])

        await helpers.local.syncDir.ensureDir('Photos')
        await helpers.local.syncDir.ensureFile('Photos/My Image.png')
        await helpers.flushLocalAndSyncAll()

        should(await helpers.local.treeWithoutTrash()).deepEqual([
          'Photos-conflict-.../',
          'Photos-conflict-.../My Image.png'
        ])
        should(await helpers.remote.treeWithoutTrash()).deepEqual([
          path(remoteDir),
          path(remoteFile),
          'Photos-conflict-.../',
          'Photos-conflict-.../My Image.png'
        ])
      })
    })
  })
})
