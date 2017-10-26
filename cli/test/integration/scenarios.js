/* eslint-env mocha */
/* @flow */

import fs from 'fs-extra'
import _ from 'lodash'
import path from 'path'
import should from 'should'
import sinon from 'sinon'

import { scenarios, loadFSEventFiles, loadRemoteChangesFiles, runActions, init } from '../helpers/scenarios'
import configHelpers from '../helpers/config'
import * as cozyHelpers from '../helpers/cozy'
import { IntegrationTestHelpers } from '../helpers/integration'
import pouchHelpers from '../helpers/pouch'
import remoteScenarioHelpers from '../../dev/capture/remote'

describe('test/scenarios/', () => {
  let helpers

  // Spies
  let sendToPrep
  let prepCalls

  before(configHelpers.createConfig)
  before(configHelpers.registerClient)
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)
  beforeEach('set up synced dir', async function () {
    await fs.emptyDir(this.syncPath)
  })
  beforeEach('set up outside dir', async function () {
    await fs.emptyDir(path.resolve(path.join(this.syncPath, '..', 'outside')))
  })

  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  beforeEach(async function () {
    helpers = new IntegrationTestHelpers(this.config, this.pouch, cozyHelpers.cozy)
    // TODO: Spy in IntegrationTestHelpers by default
    sendToPrep = sinon.spy(helpers.local.local.watcher, 'sendToPrep')
    prepCalls = []

    for (let method of ['addFileAsync', 'putFolderAsync', 'updateFileAsync',
      'moveFileAsync', 'moveFolderAsync', 'deleteFolderAsync', 'trashFileAsync',
      'trashFolderAsync', 'restoreFileAsync', 'restoreFolderAsync']) {
      sinon.stub(helpers.prep, method).callsFake(async (...args) => {
        const call: Object = {method}
        if (method.startsWith('move') || method.startsWith('restore')) {
          call.dst = args[1].path
          call.src = args[2].path
        } else if (method.startsWith('trash')) {
          call.src = args[1].path
          call.dst = args[2].path
        } else {
          call.path = args[1].path
        }
        prepCalls.push(call)

        // Call the actual method so we can make assertions on metadata & FS
        // $FlowFixMe
        helpers.prep[method].apply(helpers.prep, args)
      })
    }

    // TODO: helpers.setup()
    await helpers.local.setupTrash()
    await helpers.remote.ignorePreviousChanges()
  })

  afterEach(function () {
    // TODO: Include in custom assertion
    if (this.currentTest.state === 'failed') {
      console.log('Prep actions:', sendToPrep.getCalls().map(c => c.args[0]))
      // TODO: dump logs
    }
  })

  for (let scenario of scenarios) {
    describe(`${scenario.name}/`, () => {
      describe('local/', () => {
        if (scenario.init) {
          beforeEach('init', async function () {
            let relpathFix = _.identity
            if (process.platform === 'win32' && this.currentTest.title.match(/win32/)) {
              relpathFix = (relpath) => relpath.replace(/\//g, '\\').toUpperCase()
            }
            await init(scenario, this.pouch, helpers.local.syncDir.abspath, relpathFix)
          })
        }

        beforeEach('actions', () => runActions(scenario, helpers.local.syncDir.abspath))

        for (let eventsFile of loadFSEventFiles(scenario)) {
          if (process.platform === 'win32' && eventsFile.name.indexOf('win32') === -1) {
            it.skip(`${eventsFile.name}`, () => {})
            continue
          }

          it(eventsFile.name, async function () {
            await helpers.local.simulateEvents(eventsFile.events)
            await helpers.syncAll()

            // TODO: Wrap in custom expectation
            if (scenario.expected) {
              const expectedLocalTree = scenario.expected.tree || scenario.expected.localTree
              const expectedRemoteTree = scenario.expected.tree || scenario.expected.remoteTree
              delete scenario.expected.tree
              delete scenario.expected.prepCalls // TODO: expect prep actions
              const actual = {}

              if (expectedLocalTree) {
                scenario.expected.localTree = expectedLocalTree
                actual.localTree = await helpers.local.tree()
              }
              if (expectedRemoteTree) {
                scenario.expected.remoteTree = expectedRemoteTree
                actual.remoteTree = await helpers.remote.treeWithoutTrash()
              }
              if (scenario.expected.remoteTrash) {
                actual.remoteTrash = await helpers.remote.trash()
              }

              should(actual).deepEqual(scenario.expected)
            }

            // TODO: pull
          })
        } // event files
      }) // local

      describe('remote/', () => {
        if (scenario.init) {
          beforeEach('init', async function () {
            await remoteScenarioHelpers.createInitialTree(
              scenario, cozyHelpers.cozy, this.pouch)
          })
        }

        beforeEach('actions', async () => {
          await remoteScenarioHelpers.runActions(scenario, cozyHelpers.cozy)
        })

        for (let changesFile of loadRemoteChangesFiles(scenario)) {
          it(changesFile.name, async function () {
            console.log('simulate remote changes:', changesFile.changes)
            try {
              await helpers.remote.simulateChanges(changesFile.changes)
            } catch (err) {
              console.error(err)
              throw err
            }
            console.log('sync all...')
            await helpers.syncAll()

            console.log('look for scenario expectations...')
            if (scenario.expected) {
              console.log('gather expected remote & local data...')
              // if (scenario.expected.prepCalls) {
              //   should(prepCalls).deepEqual(scenario.expected.prepCalls)
              // }

              // TODO: Make local/remote wording direction-independant
              const expectedRemoteTree = scenario.expected.tree || scenario.expected.localTree
              const expectedLocalTree = scenario.expected.tree || scenario.expected.remoteTree
              delete scenario.expected.tree
              delete scenario.expected.prepCalls // TODO: expect prep actions
              delete scenario.expected.remoteTrash // TODO: Fake local trash
              const actual = {}

              if (expectedRemoteTree) {
                scenario.expected.remoteTree = expectedRemoteTree
                actual.remoteTree = await helpers.remote.treeWithoutTrash()
              }
              if (expectedLocalTree) {
                scenario.expected.localTree = expectedLocalTree
                actual.localTree = await helpers.local.tree()
              }

              should(actual).deepEqual(scenario.expected)
            }
          }) // changes file test
        } // for changes files
      }) // describe remote
    }) // scenario
  } // scenarios
})
