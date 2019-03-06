/* eslint-env mocha */
/* @flow */

const should = require('should')
const Builders = require('../../../support/builders')
const configHelpers = require('../../../support/helpers/config')
const pouchHelpers = require('../../../support/helpers/pouch')

const Buffer = require('../../../../core/local/steps/buffer')
const initialDiff = require('../../../../core/local/steps/initial_diff')

const kind = doc => doc.docType === 'folder' ? 'directory' : 'file'

describe('local/steps/initial_diff', () => {
  let builders

  before('instanciate config', configHelpers.createConfig)
  beforeEach('instanciate pouch', pouchHelpers.createDatabase)
  beforeEach('populate pouch with documents', function () {
    builders = new Builders({pouch: this.pouch})
  })
  afterEach('clean pouch', pouchHelpers.cleanDatabase)
  after('clean config directory', configHelpers.cleanConfig)

  describe('.initialState()', () => {
    it('returns initial state referenced by initial diff step name', async function () {
      const foo = await builders.metadir().path('foo').ino(1).create()
      const fizz = await builders.metafile().path('fizz').ino(2).create()

      const state = await initialDiff.initialState(this)
      should(state).have.property(initialDiff.STEP_NAME, {
        waiting: [],
        byInode: new Map([
          [foo.ino, { path: foo.path, kind: kind(foo) }],
          [fizz.ino, { path: fizz.path, kind: kind(fizz) }]
        ]),
        byPath: new Map()
      })
    })
  })

  describe('.loop()', () => {
    let buffer
    let initialScanDone

    beforeEach('populate pouch with documents', function () {
      buffer = new Buffer()
      initialScanDone = builders.event().action('initial-scan-done').kind('unknown').path('').build()
    })

    it('detects documents moved while client was stopped', async function () {
      await builders.metadir().path('foo').ino(1).create()
      await builders.metafile().path('fizz').ino(2).create()

      const state = await initialDiff.initialState({ pouch: this.pouch })

      const bar = builders.event().action('scan').kind('directory').path('bar').ino(1).build()
      const buzz = builders.event().action('scan').kind('file').path('buzz').ino(2).build()
      buffer.push([bar, buzz, initialScanDone])
      buffer = initialDiff.loop(buffer, { pouch: this.pouch, state })

      const events = await buffer.pop()
      should(events).deepEqual([
        builders.event(bar).action('renamed').oldPath('foo').build(),
        builders.event(buzz).action('renamed').oldPath('fizz').build(),
        initialScanDone
      ])
    })

    it('detects documents moved while client is doing initial scan', async function () {
      await builders.metadir().path('foo').ino(1).create()
      await builders.metafile().path('foo/baz').ino(2).create()
      await builders.metadir().path('bar').ino(3).create()

      const state = await initialDiff.initialState({ pouch: this.pouch })

      const foo = builders.event().action('scan').kind('directory').path('foo').ino(1).build()
      const barbaz = builders.event().action('created').kind('file').path('bar/baz').ino(2).build()
      buffer.push([foo, barbaz])
      const bar = builders.event().action('scan').kind('directory').path('bar').ino(3).build()
      buffer.push([
        bar,
        builders.event().action('scan').kind('file').path('bar/baz').ino(2).build(),
        initialScanDone
      ])
      buffer = initialDiff.loop(buffer, { pouch: this.pouch, state })

      const events = [].concat(
        await buffer.pop(),
        await buffer.pop()
      )
      should(events).deepEqual([
        foo,
        builders.event(barbaz).action('renamed').oldPath('foo/baz').build(),
        bar,
        initialScanDone
      ])
    })

    it('detects documents replaced by another one of a different kind while client was stopped', async function () {
      await builders.metadir().path('foo').ino(1).create()
      await builders.metafile().path('bar').ino(2).create()
      await builders.metadir().path('fizz').ino(3).create()
      await builders.metafile().path('buzz').ino(4).create()

      const state = await initialDiff.initialState({ pouch: this.pouch })

      const foo = builders.event().action('scan').kind('file').path('foo').ino(2).build()
      const buzz = builders.event().action('scan').kind('directory').path('buzz').ino(3).build()
      buffer.push([foo, buzz, initialScanDone])
      buffer = initialDiff.loop(buffer, { pouch: this.pouch, state })

      const events = await buffer.pop()
      should(events).deepEqual([
        builders.event(foo).action('renamed').oldPath('bar').build(),
        builders.event(buzz).action('renamed').oldPath('fizz').build(),
        initialScanDone
      ])
    })

    it('detects documents replaced by another one with a different ino while client was stopped', async function () {
      await builders.metadir().path('foo').ino(1).create()
      await builders.metafile().path('bar').ino(2).create()

      const state = await initialDiff.initialState({ pouch: this.pouch })

      const foo = builders.event().action('scan').kind('directory').path('foo').ino(3).build()
      const bar = builders.event().action('scan').kind('file').path('bar').ino(4).build()
      buffer.push([foo, bar, initialScanDone])
      buffer = initialDiff.loop(buffer, { pouch: this.pouch, state })

      const events = await buffer.pop()
      should(events).deepEqual([
        foo,
        bar,
        initialScanDone
      ])
    })

    it('detects documents removed while client was stopped', async function () {
      const foo = await builders.metadir().path('foo').ino(1).create()
      const bar = await builders.metafile().path('bar').ino(2).create()

      const state = await initialDiff.initialState({ pouch: this.pouch })

      buffer.push([initialScanDone])
      buffer = initialDiff.loop(buffer, { pouch: this.pouch, state })

      const events = await buffer.pop()
      should(events).deepEqual([
        {
          _id: bar._id,
          action: 'deleted',
          initialDiff: {notFound: {kind: 'file', path: bar.path}},
          kind: 'file',
          path: bar.path
        },
        {
          _id: foo._id,
          action: 'deleted',
          initialDiff: {notFound: {kind: 'directory', path: foo.path}},
          kind: 'directory',
          path: foo.path
        },
        initialScanDone
      ])
    })
  })
})
