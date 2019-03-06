/* eslint-env mocha */
/* @flow */

const path = require('path')
const should = require('should')
const sinon = require('sinon')

const metadata = require('../../../../core/metadata')
const stater = require('../../../../core/local/stater')
const Buffer = require('../../../../core/local/steps/buffer')
const incompleteFixer = require('../../../../core/local/steps/incomplete_fixer')

const Builders = require('../../../support/builders')

const builders = new Builders()

describe('core/local/steps/incomplete_fixer', () => {
  const syncPath = __dirname

  let checksumer

  beforeEach(() => {
    checksumer = {
      push: sinon.stub().resolves(),
      kill: sinon.stub()
    }
  })

  describe('.loop()', () => {
    it('pushes a fixed event into the output buffer', async () => {
      const createdEvent = builders.event()
        .kind('file')
        .action('created')
        .path('missing')
        .incomplete()
        .build()
      const renamedEvent = builders.event()
        .kind(createdEvent.kind)
        .action('renamed')
        .oldPath(createdEvent.path)
        .path(__filename)
        .build()
      const inputBuffer = new Buffer()
      const outputBuffer = incompleteFixer.loop(inputBuffer, {syncPath, checksumer})

      inputBuffer.push([createdEvent])
      inputBuffer.push([renamedEvent])

      should(await outputBuffer.pop()).deepEqual([
        {
          _id: renamedEvent._id,
          action: 'renamed',
          kind: 'file',
          oldPath: createdEvent.path,
          path: renamedEvent.path,
          stats: renamedEvent.stats
        }
      ])
    })
  })

  describe('.step()', () => {
    describe('file renamed then deleted', () => {
      it('is deleted at its original path', async () => {
        const src = 'src'
        const dst = 'dst'
        const renamedEvent = builders.event()
          .kind('file')
          .action('renamed')
          .oldPath(src)
          .path(dst)
          .incomplete()
          .build()
        const deletedEvent = builders.event()
          .kind(renamedEvent.kind)
          .action('deleted')
          .path(dst)
          .build()
        const incompletes = []
        const outputBatches = []

        for (const inputBatch of [[renamedEvent], [deletedEvent]]) {
          const outputBatch = await incompleteFixer.step(incompletes, {syncPath, checksumer})(inputBatch)
          outputBatches.push(outputBatch)
        }

        should(outputBatches).deepEqual([
          [],
          [
            deletedEvent, // OPTIMIZE: Drop useless event
            {
              _id: metadata.id(src),
              action: 'deleted',
              incompleteFixer: {
                incompleteEvent: renamedEvent,
                completingEvent: deletedEvent
              },
              kind: renamedEvent.kind,
              path: src
            }
          ]
        ])
      })
    })

    describe('file renamed twice', () => {
      it('is renamed once as a whole', async () => {
        const src = 'src'
        const dst1 = 'dst1'
        const dst2 = path.basename(__filename)
        const firstRenamedEvent = builders.event()
          .kind('file')
          .action('renamed')
          .oldPath(src)
          .path(dst1)
          .incomplete()
          .build()
        const secondRenamedEvent = builders.event()
          .kind('file')
          .action('renamed')
          .oldPath(dst1)
          .path(dst2)
          .build()
        const incompletes = []
        const outputBatches = []
        const md5sum = 'whatever'

        checksumer.push.resolves(md5sum)

        for (const inputBatch of [[firstRenamedEvent], [secondRenamedEvent]]) {
          const outputBatch = await incompleteFixer.step(incompletes, {syncPath, checksumer})(inputBatch)
          outputBatches.push(outputBatch)
        }

        should(outputBatches).deepEqual([
          [],
          [
            {
              _id: metadata.id(dst2),
              action: 'renamed',
              incompleteFixer: {
                incompleteEvent: firstRenamedEvent,
                completingEvent: secondRenamedEvent
              },
              kind: 'file',
              md5sum,
              oldPath: src,
              path: dst2,
              stats: await stater.stat(path.join(syncPath, dst2))
            }
          ]
        ])
      })
    })
  })
})
