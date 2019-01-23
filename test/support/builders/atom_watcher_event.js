/* @flow */

const fs = require('fs')
const _ = require('lodash')
const path = require('path')

const metadata = require('../../../core/metadata')
const events = require('../../../core/local/steps/event')

/*::
import type { Stats } from 'fs'
import type { AtomWatcherEvent, EventAction, EventKind, Batch } from '../../../core/local/steps/event'
*/

function randomPick /*:: <T> */ (elements /*: Array<T> */) /*: T */{
  const l = elements.length
  const i = Math.floor(Math.random() * l)
  return elements[i]
}

module.exports = class AtomWatcherEventBuilder {
  /*::
  _event: AtomWatcherEvent
  */

  constructor (old /*: ?AtomWatcherEvent */) {
    if (old) {
      this._event = _.cloneDeep(old)
    } else {
      this._event = {
        action: randomPick(events.ACTIONS),
        kind: randomPick(events.KINDS),
        path: '/',
        _id: '/'
      }
    }
  }

  build () /*: AtomWatcherEvent */ {
    return this._event
  }

  action (newAction /*: EventAction */) /*: this */ {
    this._event.action = newAction
    return this
  }

  kind (newKind /*: EventKind */) /*: this */ {
    this._event.kind = newKind
    return this
  }

  path (newPath /*: string */) /*: this */ {
    this._event.path = path.normalize(newPath)
    this._event._id = metadata.id(newPath)
    return this
  }

  oldPath (newPath /*: string */) /*: this */{
    this._event.oldPath = path.normalize(newPath)
    return this
  }

  id (newId /*: string */) /*: this */ {
    this._event._id = newId
    return this
  }

  stats (newStats /*: { ino?: number } */) /*: this */ {
    const stats /*: Stats */ = fs.statSync(__filename)
    Object.assign(stats, newStats)

    this._event.stats = stats
    return this
  }

  md5sum (newMd5sum /*: string */) /*: this */ {
    this._event.md5sum = newMd5sum
    return this
  }

  noIgnore () /*: this */ {
    this._event.noIgnore = true
    return this
  }
}
