/* eslint-env mocha */
/* @flow */

const should = require('should')
const Builders = require('../../../support/builders')
const configHelpers = require('../../../support/helpers/config')
const pouchHelpers = require('../../../support/helpers/pouch')

const Buffer = require('../../../../core/local/steps/buffer')
const initialDiff = require('../../../../core/local/steps/initial_diff')

describe('local/steps/initial_diff.loop()', () => {
  let builders
  let buffer

  before('instanciate config', configHelpers.createConfig)
  beforeEach('instanciate pouch', pouchHelpers.createDatabase)
  beforeEach('populate pouch with documents', function () {
    builders = new Builders({pouch: this.pouch})
    buffer = new Buffer()
  })
  afterEach('clean pouch', pouchHelpers.cleanDatabase)
  after('clean config directory', configHelpers.cleanConfig)

  it('detects documents moved while client was stopped', async function () {
    await builders.metadir().path('foo').ino(1).create()
    await builders.metafile().path('fizz').ino(2).create()

    const bar = builders.event().action('scan').kind('directory').path('bar').ino(1).build()
    const buzz = builders.event().action('scan').kind('file').path('buzz').ino(2).build()
    buffer.push([bar, buzz])
    buffer = initialDiff.loop(buffer, { pouch: this.pouch })

    const events = await buffer.pop()
    should(events).deepEqual([
      builders.event(bar).action('renamed').oldPath('foo').build(),
      builders.event(buzz).action('renamed').oldPath('fizz').build()
    ])
  })

  it('detects documents moved while client is doing initial scan', async function () {
    await builders.metadir().path('foo').ino(1).create()
    await builders.metafile().path('foo/baz').ino(2).create()
    await builders.metadir().path('bar').ino(3).create()

    const foo = builders.event().action('scan').kind('directory').path('foo').ino(1).build()
    const barbaz = builders.event().action('created').kind('file').path('bar/baz').ino(2).build()
    buffer.push([foo, barbaz])
    const bar = builders.event().action('scan').kind('directory').path('bar').ino(3).build()
    buffer.push([
      bar,
      builders.event().action('scan').kind('file').path('bar/baz').ino(2).build()
    ])
    buffer = initialDiff.loop(buffer, { pouch: this.pouch })

    const events = [].concat(
      await buffer.pop(),
      await buffer.pop()
    )
    should(events).deepEqual([
      foo,
      builders.event(barbaz).action('renamed').oldPath('foo/baz').build(),
      bar
    ])
  })

  it('detects documents replaced by another one of a different kind while client was stopped', async function () {
    await builders.metadir().path('foo').ino(1).create()
    await builders.metafile().path('bar').ino(2).create()
    await builders.metadir().path('fizz').ino(3).create()
    await builders.metafile().path('buzz').ino(4).create()

    const foo = builders.event().action('scan').kind('file').path('foo').ino(2).build()
    const buzz = builders.event().action('scan').kind('directory').path('buzz').ino(3).build()
    buffer.push([foo, buzz])
    buffer = initialDiff.loop(buffer, { pouch: this.pouch })

    const events = await buffer.pop()
    should(events).deepEqual([
      builders.event(foo).action('renamed').oldPath('bar').build(),
      builders.event(buzz).action('renamed').oldPath('fizz').build()
    ])
  })

  it('detects documents removed while client was stopped', async function () {
    await builders.metadir().path('foo').ino(1).create()
    await builders.metafile().path('bar').ino(2).create()

    const initial = builders.event().action('initial-scan-done').build()
    buffer.push([initial])
    buffer = initialDiff.loop(buffer, { pouch: this.pouch })

    const events = await buffer.pop()
    should(events).deepEqual([
      builders.event().action('deleted').kind('file').path('bar').build(),
      builders.event().action('deleted').kind('directory').path('foo').build(),
      initial
    ])
  })
})