/* eslint-env mocha */
/* @flow */

const _ = require('lodash')
const should = require('should')

const awaitWriteFinish = require('../../../../core/local/steps/await_write_finish')
const Channel = require('../../../../core/local/steps/channel')
const stater = require('../../../../core/local/stater')

const lastEventToCheckEmptyness = {
  action: 'initial-scan-done',
  kind: 'unknown',
  path: ''
}

async function heuristicIsEmpty(channel) {
  const expected = await channel.pop()
  return (
    (expected.length === 1 &&
      Object.keys(expected[0]).reduce(
        (acc, prop) =>
          acc && expected[0][prop] === lastEventToCheckEmptyness[prop],
        true
      )) ||
    console.log(expected) // eslint-disable-line no-console
  )
}

describe('core/local/steps/await_write_finish.loop()', () => {
  context('with many batches', () => {
    it('should reduce created→deleted to empty', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'created',
          kind: 'file',
          path: __filename
        },
        {
          action: 'deleted',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      originalBatch.forEach(event => {
        channel.push([Object.assign({}, event)])
      })
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await heuristicIsEmpty(enhancedChannel)).be.true()
    })

    it('should reduce modified→deleted to deleted', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'modified',
          kind: 'file',
          path: __filename
        },
        {
          action: 'deleted',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      originalBatch.forEach(event => {
        channel.push([Object.assign({}, event)])
      })
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([originalBatch[1]])
      should(await heuristicIsEmpty(enhancedChannel)).be.true()
    })

    describe('created→modified→modified with or without deleted', () => {
      it('should reduce created→modified→modified to created', async () => {
        const channel = new Channel()
        const originalBatch = [
          {
            action: 'created',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          lastEventToCheckEmptyness
        ]
        originalBatch.forEach(event => {
          channel.push([Object.assign({}, event)])
        })
        const enhancedChannel = awaitWriteFinish.loop(channel, {})
        should(await enhancedChannel.pop()).eql([
          {
            // 3rd modified -> created
            action: 'created',
            awaitWriteFinish: {
              previousEvents: [
                {
                  // 2nd modified -> created
                  action: 'created'
                },
                {
                  // 1st created
                  action: 'created'
                }
              ]
            },
            kind: 'file',
            path: __filename
          }
        ])
        should(await heuristicIsEmpty(enhancedChannel)).be.true()
      })

      it('should reduce created→modified→modified→deleted to empty', async () => {
        const channel = new Channel()
        const originalBatch = [
          {
            action: 'created',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'deleted',
            kind: 'file',
            path: __filename
          },
          lastEventToCheckEmptyness
        ]
        originalBatch.forEach(event => {
          channel.push([Object.assign({}, event)])
        })
        const enhancedChannel = awaitWriteFinish.loop(channel, {})
        should(await heuristicIsEmpty(enhancedChannel)).be.true()
      })
    })

    it('should reduce modified→modified to latest modified', async () => {
      const fileStats = await stater.stat(__filename)
      const stats1 = {
        ...fileStats,
        size: 1
      }
      const stats2 = {
        ...fileStats,
        size: 2
      }
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          stats: stats1
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          stats: stats2
        },
        lastEventToCheckEmptyness
      ]
      originalBatch.forEach(event => {
        channel.push([Object.assign({}, event)])
      })
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([
        {
          action: 'modified',
          awaitWriteFinish: {
            previousEvents: [
              {
                action: 'modified',
                stats: _.pick(stats1, [
                  'ino',
                  'fileid',
                  'size',
                  'atime',
                  'mtime',
                  'ctime',
                  'birthtime'
                ])
              }
            ]
          },
          kind: 'file',
          path: __filename,
          stats: stats2
        }
      ])
      should(await heuristicIsEmpty(enhancedChannel)).be.true()
    })

    it('should not squash incomplete events', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'created',
          kind: 'file',
          path: __filename
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          incomplete: true
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      originalBatch.forEach(event => {
        channel.push([Object.assign({}, event)])
      })
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([originalBatch[1]])
      should(await enhancedChannel.pop()).eql([
        {
          // 3rd modified -> created
          action: 'created',
          awaitWriteFinish: {
            previousEvents: [
              {
                // 1st created -> created
                action: 'created'
              }
            ]
          },
          kind: 'file',
          path: __filename
        }
      ])
      should(await heuristicIsEmpty(enhancedChannel)).be.true()
    })
  })

  context('with one batch', () => {
    it('should reduce created→deleted to empty', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'created',
          kind: 'file',
          path: __filename
        },
        {
          action: 'deleted',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      channel.push(_.cloneDeep(originalBatch))
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([lastEventToCheckEmptyness])
    })

    it('should reduce modified→deleted to deleted', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'modified',
          kind: 'file',
          path: __filename
        },
        {
          action: 'deleted',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      channel.push(_.cloneDeep(originalBatch))
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([
        originalBatch[1],
        lastEventToCheckEmptyness
      ])
    })

    describe('created→modified→modified with or without deleted', () => {
      it('should reduce created→modified→modified to created', async () => {
        const channel = new Channel()
        const originalBatch = [
          {
            action: 'created',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          lastEventToCheckEmptyness
        ]
        channel.push(_.cloneDeep(originalBatch))
        const enhancedChannel = awaitWriteFinish.loop(channel, {})
        should(await enhancedChannel.pop()).eql([
          {
            // 3rd modified -> created
            action: 'created',
            awaitWriteFinish: {
              previousEvents: [
                {
                  // 2nd modified -> created
                  action: 'created'
                },
                {
                  // 1st created
                  action: 'created'
                }
              ]
            },
            kind: 'file',
            path: __filename
          },
          lastEventToCheckEmptyness
        ])
      })

      it('should reduce created→modified→modified→deleted to empty', async () => {
        const channel = new Channel()
        const originalBatch = [
          {
            action: 'created',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'modified',
            kind: 'file',
            path: __filename
          },
          {
            action: 'deleted',
            kind: 'file',
            path: __filename
          },
          lastEventToCheckEmptyness
        ]
        channel.push(_.cloneDeep(originalBatch))
        const enhancedChannel = awaitWriteFinish.loop(channel, {})
        should(await enhancedChannel.pop()).eql([lastEventToCheckEmptyness])
      })
    })

    it('should reduce modified→modified to latest modified', async () => {
      const fileStats = await stater.stat(__filename)
      const stats1 = {
        ...fileStats,
        size: 1
      }
      const stats2 = {
        ...fileStats,
        size: 2
      }
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          stats: stats1
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          stats: stats2
        },
        lastEventToCheckEmptyness
      ]
      channel.push(_.cloneDeep(originalBatch))
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([
        {
          action: 'modified',
          awaitWriteFinish: {
            previousEvents: [
              {
                action: 'modified',
                stats: _.pick(stats1, [
                  'ino',
                  'fileid',
                  'size',
                  'atime',
                  'mtime',
                  'ctime',
                  'birthtime'
                ])
              }
            ]
          },
          kind: 'file',
          path: __filename,
          stats: stats2
        },
        lastEventToCheckEmptyness
      ])
    })

    it('should not squash incomplete events', async () => {
      const channel = new Channel()
      const originalBatch = [
        {
          action: 'created',
          kind: 'file',
          path: __filename
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename,
          incomplete: true
        },
        {
          action: 'modified',
          kind: 'file',
          path: __filename
        },
        lastEventToCheckEmptyness
      ]
      channel.push(_.cloneDeep(originalBatch))
      const enhancedChannel = awaitWriteFinish.loop(channel, {})
      should(await enhancedChannel.pop()).eql([
        {
          // 3rd modified -> created
          action: 'created',
          awaitWriteFinish: {
            previousEvents: [
              {
                // 1st created
                action: 'created'
              }
            ]
          },
          kind: 'file',
          path: __filename
        },
        originalBatch[1],
        lastEventToCheckEmptyness
      ])
    })
  })
})
