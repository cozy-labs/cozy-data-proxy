/* @flow */

import {
  after,
  afterEach,
  before,
  beforeEach,
  suite,
  test
} from 'mocha'
import should from 'should'
import sinon from 'sinon'

import Builders from '../support/builders'
import configHelpers from '../support/helpers/config'
import * as cozyHelpers from '../support/helpers/cozy'
import pouchHelpers from '../support/helpers/pouch'
import { IntegrationTestHelpers } from '../support/helpers/integration'

suite('Sync state', () => {
  before(configHelpers.createConfig)
  before(configHelpers.registerClient)
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)

  // afterEach(() => helpers.local.clean())
  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  let builders, events, helpers

  beforeEach(function () {
    helpers = new IntegrationTestHelpers(this.config, this.pouch, cozyHelpers.cozy)
    builders = new Builders(cozyHelpers.cozy, this.pouch)
    events = helpers.events
    sinon.spy(events, 'emit')
    // await helpers.local.setupTrash()
    // await helpers.remote.ignorePreviousChanges()
  })

  test('1 sync error (missing remote file)', async () => {
    await helpers._remote.watcher.pullMany([
      builders.remote.file().build()
    ])
    await helpers.syncAll()
    should(events.emit.args).deepEqual([
      ['remote-start'],
      ['syncing'],
      ['sync-target', 4],
      ['remote-end'],
      ['up-to-date'],
      ['sync-start'],
      ['syncing'],
      // FIXME: 3 attempts to download a missing file
      // FIXME: in debug.log with DEBUG=1: Sync: Seq was already synced! (seq=0)
      ['sync-current', 4],
      ['sync-current', 5],
      ['sync-current', 6],
      ['sync-end'],
      ['up-to-date']
    ])
  })
})
