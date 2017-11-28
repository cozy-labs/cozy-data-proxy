/* eslint-env mocha */
/* @flow */

import fs from 'fs-extra'
import _ from 'lodash'
import should from 'should'
import sinon from 'sinon'

import { runActions, init } from '../helpers/scenarios'
import configHelpers from '../helpers/config'
import * as cozyHelpers from '../helpers/cozy'
import { IntegrationTestHelpers } from '../helpers/integration'
import pouchHelpers from '../helpers/pouch'

let helpers

// Spies
let prepCalls

describe('TRELLO #484: Local sort before squash (https://trello.com/c/RcRmqymw)', function () {
  before(configHelpers.createConfig)
  before(configHelpers.registerClient)
  beforeEach(pouchHelpers.createDatabase)
  beforeEach(cozyHelpers.deleteAll)
  beforeEach('set up synced dir', async function () {
    await fs.emptyDir(this.syncPath)
  })

  afterEach(pouchHelpers.cleanDatabase)
  after(configHelpers.cleanConfig)

  beforeEach(async function () {
    helpers = new IntegrationTestHelpers(this.config, this.pouch, cozyHelpers.cozy)
    prepCalls = []

    for (let method of ['addFileAsync', 'putFolderAsync', 'updateFileAsync',
      'moveFileAsync', 'moveFolderAsync', 'deleteFolderAsync', 'trashFileAsync',
      'trashFolderAsync', 'restoreFileAsync', 'restoreFolderAsync']) {
      sinon.stub(helpers.prep, method).callsFake(async (...args) => {
        const call: Object = {method}
        if (method.startsWith('move') || method.startsWith('restore')) {
          call.dst = args[1].path
          call.src = args[2].path
        } else {
          call.path = args[1].path
        }
        prepCalls.push(call)
      })
    }
  })

  it('is fixed', async function () {
    await init({init: [
      {ino: 0, path: 'Administratif/'},
      {ino: 1, path: 'eBooks/'},
      {ino: 2, path: 'eBooks/Learning JavaScript/'},
      {ino: 3, path: 'eBooks/Learning JavaScript/Learning JavaScript.epub'},
      {ino: 4, path: 'eBooks/Mastering Cassandra/'},
      {ino: 5, path: 'eBooks/Mastering Cassandra/9781782162681_CASSANDRA.pdf'},
      {ino: 6, path: 'eBooks/Mastering Node.js/'},
      {ino: 7, path: 'eBooks/Mastering Node.js/book.mobi'},
      {ino: 8, path: 'eBooks/Mastering Node.js/book.pdf'},
      {ino: 9, path: 'facture-boulanger.pdf'}
    ]}, this.pouch, helpers.local.syncDir.abspath, _.identity)
    await runActions({actions: [
      {type: 'mv', src: 'facture-boulanger.pdf', dst: 'Administratif/facture-boulanger.pdf'},
      {type: 'mv', src: 'eBooks', dst: 'Livres'},
      // File is deleted after flush but before analysis (race condition):
      {type: 'delete', path: 'Administratif/facture-boulanger.pdf'}
    ]}, helpers.local.syncDir.abspath, _.identity)

    // $FlowFixMe
    await helpers.local.simulateEvents([
      {type: 'unlink', path: 'facture-boulanger.pdf'},
      {type: 'add', path: 'Administratif/facture-boulanger.pdf', stats: {ino: 9, size: 209045, mtime: new Date('2017-10-09T08:40:44.298Z'), ctime: new Date('2017-10-09T08:40:44.298Z')}},
      {type: 'unlinkDir', path: 'eBooks/Learning JavaScript'},
      {type: 'unlinkDir', path: 'eBooks/Mastering Cassandra'},
      {type: 'unlinkDir', path: 'eBooks/Mastering Node.js'},
      {type: 'unlinkDir', path: 'eBooks'},
      {type: 'addDir', path: 'Livres', stats: {ino: 1, size: 4096, mtime: new Date('2017-10-09T08:40:51.472Z'), ctime: new Date('2017-10-09T08:40:51.472Z')}},
      {type: 'addDir', path: 'Livres/Learning JavaScript', stats: {ino: 2, size: 4096, mtime: new Date('2017-10-09T08:40:51.478Z'), ctime: new Date('2017-10-09T08:40:51.478Z')}},
      {type: 'addDir', path: 'Livres/Mastering Cassandra', stats: {ino: 4, size: 4096, mtime: new Date('2017-10-09T08:40:51.479Z'), ctime: new Date('2017-10-09T08:40:51.479Z')}},
      {type: 'addDir', path: 'Livres/Mastering Node.js', stats: {ino: 6, size: 4096, mtime: new Date('2017-10-09T08:40:51.479Z'), ctime: new Date('2017-10-09T08:40:51.479Z')}},
      {type: 'unlink', path: 'eBooks/Learning JavaScript/Learning JavaScript.epub'},
      {type: 'unlink', path: 'eBooks/Mastering Cassandra/9781782162681_CASSANDRA.pdf'},
      {type: 'unlink', path: 'eBooks/Mastering Node.js/book.mobi'},
      {type: 'unlink', path: 'eBooks/Mastering Node.js/book.pdf'},
      {type: 'add', path: 'Livres/Mastering Node.js/book.mobi', stats: {ino: 7, size: 16760, mtime: new Date('2017-10-09T08:40:52.521Z'), ctime: new Date('2017-10-09T08:40:52.521Z')}},
      {type: 'add', path: 'Livres/Mastering Node.js/book.pdf', stats: {ino: 8, size: 286325, mtime: new Date('2017-10-09T08:40:52.521Z'), ctime: new Date('2017-10-09T08:40:52.521Z')}},
      {type: 'add', path: 'Livres/Learning JavaScript/Learning JavaScript.epub', stats: {ino: 3, size: 1699609, mtime: new Date('2017-10-09T08:40:52.521Z'), ctime: new Date('2017-10-09T08:40:52.521Z')}},
      {type: 'add', path: 'Livres/Mastering Cassandra/9781782162681_CASSANDRA.pdf', stats: {ino: 5, size: 3091364, mtime: new Date('2017-10-09T08:40:52.522Z'), ctime: new Date('2017-10-09T08:40:52.522Z')}}
    ])

    should(prepCalls).deepEqual([
      // XXX: In this case, trashing the file is ok, but it would be a mistake
      // in case of a move occurring during analysis...
      {method: 'trashFileAsync', path: 'facture-boulanger.pdf'},
      {method: 'moveFolderAsync', src: 'eBooks', dst: 'Livres'}
    ])
  })
})
