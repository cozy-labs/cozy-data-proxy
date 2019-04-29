/* @flow */

const _ = require('lodash')

const Buffer = require('./buffer')
const logger = require('../../logger')

/*::
import type { AtomWatcherEvent, Batch } from './event'
import type { Metadata } from '../../metadata'

type OverwritingMoveState = {
  deletedEventsByPath: Map<string, AtomWatcherEvent>,
  pending: {
    deletedEventsByPath: Map<string, AtomWatcherEvent>,
    events: Batch,
    timeout?: TimeoutID
  }
}

type PouchFunctions = {
  byIdMaybeAsync: (string) => Promise<?Metadata>
}

type OverwritingMoveOptions = {
  state: {
    [typeof STEP_NAME]: OverwritingMoveState
  }
}
*/

const STEP_NAME = 'overwritingMove'

const log = logger({
  component: `atom/${STEP_NAME}`
})

// Wait at most this delay (in milliseconds) to fix overwriting move related
// events.
const DELAY = 500

const initialState = () => ({
  [STEP_NAME]: {
    // eslint-disable-next-line
    deletedEventsByPath: new Map /*:: <string,AtomWatcherEvent> */ (),
    pending: {
      // eslint-disable-next-line
      deletedEventsByPath: new Map /*:: <string,AtomWatcherEvent> */ (),
      events: []
    }
  }
})

/** Current batch becomes pending.
 *
 * So we can:
 * - Detect overwriting move events in the next one.
 * - Possibly aggregate deleted events from the current (now pending) one.
 */
const rotateState = (state, events) => {
  state.pending = {
    deletedEventsByPath: state.deletedEventsByPath,
    events
  }
  state.deletedEventsByPath = new Map()
}

/** Deleted event ids match moved ones. */
const indexDeletedEvent = (event, state) => {
  if (event.action === 'deleted') {
    state.deletedEventsByPath.set(event.path, event)
  }
}

/** Possibly change event action to 'ignored'.
 *
 * In case it is a deleted event related to an overwriting move.
 */
const ignoreDeletedBeforeOverwritingMove = (event, state) => {
  const { path } = event
  const pendingDeletedEvent =
    state.deletedEventsByPath.get(path) ||
    state.pending.deletedEventsByPath.get(path)
  if (pendingDeletedEvent) {
    const deletedClone = _.clone(pendingDeletedEvent)
    const renamedClone = _.clone(event)

    event.overwrite = true
    _.set(event, [STEP_NAME, 'moveToDeletedPath'], deletedClone)
    pendingDeletedEvent.action = 'ignored'
    _.set(
      pendingDeletedEvent,
      [STEP_NAME, 'deletedBeforeRenamed'],
      renamedClone
    )
  }
}

/** Process an event batch. */
const step = async (batch /*: Batch */, opts /*: OverwritingMoveOptions */) => {
  const {
    state: { [STEP_NAME]: state }
  } = opts

  for (const event of batch) {
    indexDeletedEvent(event, state)

    if (event.action === 'renamed') {
      ignoreDeletedBeforeOverwritingMove(event, state)
    }
  }
}

const _loop = async (buffer, out, opts) => {
  const output = pending => {
    clearTimeout(pending.timeout)
    out.push(pending.events)
    pending.deletedEventsByPath = new Map()
    pending.events = []
  }

  for (;;) {
    const events = await buffer.pop()
    const {
      state: { [STEP_NAME]: state }
    } = opts

    await step(events, opts)

    output(state.pending)
    rotateState(state, events)

    const { pending } = state
    pending.timeout = setTimeout(() => {
      output(pending)
    }, DELAY)
  }
}

const loop = (buffer /*: Buffer */, opts /*: OverwritingMoveOptions */) => {
  const out = new Buffer()

  _loop(buffer, out, opts).catch(err => {
    log.error({ err })
  })

  return out
}

module.exports = {
  STEP_NAME,
  initialState,
  loop,
  step
}
