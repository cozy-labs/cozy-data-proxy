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

import configHelpers from '../support/helpers/config'
import * as cozyHelpers from '../support/helpers/cozy'
import pouchHelpers from '../support/helpers/pouch'
import { IntegrationTestHelpers } from '../support/helpers/integration'

const cozy = cozyHelpers.cozy

suite('Permanent deletion (remote only)', () => {
  let helpers

  before(configHelpers.createConfig)
  before(configHelpers.registerClient)
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)

  afterEach(() => helpers.local.clean())
  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  beforeEach(function () {
    helpers = new IntegrationTestHelpers(this.config, this.pouch, cozy)
    helpers.local.setupTrash()
  })

  test('file', async () => {
    await helpers.remote.ignorePreviousChanges()
    const file = await cozy.files.create('File content', {name: 'file'})
    await helpers.remote.pullChanges()
    await helpers.syncAll()
    helpers.spyPouch()

    await cozy.files.trashById(file._id)
    await cozy.files.destroyById(file._id)
    await helpers.remote.pullChanges()

    should(helpers.putDocs('path', '_deleted', 'trashed')).deepEqual([
      {path: 'file', _deleted: true}
    ])

    await helpers.syncAll()

    should(await helpers.local.tree()).deepEqual([
      '/Trash/file'
    ])
  })
})
