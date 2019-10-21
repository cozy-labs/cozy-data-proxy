/**
 * @module core/remote/watcher
 * @flow
 */

const _ = require('lodash')
const path = require('path')

const remoteChange = require('../change')

const sideName = 'remote'

/*::
import type { Metadata } from '../../metadata'
import type { RemoteChange, RemoteFileMove, RemoteDirMove, RemoteDescendantChange } from '../change'
*/

const buildChange = (sideName, doc, was) => {
  if (doc.docType === 'file') {
    return {
      sideName,
      type: 'FileMove',
      update: was.md5sum !== doc.md5sum, // move + change
      doc,
      was
    }
  } else {
    return {
      sideName,
      type: 'DirMove',
      doc,
      was
    }
  }
}

const findParentMoves = (
  change /*: RemoteChange */,
  previousChanges /*: RemoteChange[] */,
  encounteredMoves /*: Array<RemoteDirMove|RemoteDescendantChange> */
) => {
  const parentMove /*: ?RemoteDirMove|RemoteDescendantChange */ = encounteredMoves.find(
    move => remoteChange.isChildMove(move, change)
  )
  let squashedParentMove /*: ?RemoteDirMove|RemoteDescendantChange */
  if (parentMove) {
    for (const previousChange of previousChanges) {
      if (
        (previousChange.type === 'DirMove' ||
          previousChange.type === 'DescendantChange') &&
        previousChange.doc._id === parentMove.doc._id
      ) {
        squashedParentMove = previousChange
        break
      }
    }
  } else {
    for (const previousChange of previousChanges) {
      if (
        (previousChange.type === 'DirMove' ||
          previousChange.type === 'DescendantChange') &&
        remoteChange.isChildMove(previousChange, change)
      )
        squashedParentMove = previousChange
      break
    }
  }

  return { parentMove, squashedParentMove }
}

const findChildrenMoves = (
  change /*: RemoteDirMove|RemoteDescendantChange */,
  originalChange /*: ?RemoteDirMove|RemoteDescendantChange */,
  previousChanges /*: RemoteChange[] */
) /*: Array<RemoteFileMove|RemoteDirMove> */ => {
  const childrenMoves = []
  for (const previousChange of previousChanges) {
    if (
      (previousChange.type === 'FileMove' ||
        previousChange.type === 'DirMove') &&
      (remoteChange.isChildMove(change, previousChange) ||
        (originalChange &&
          remoteChange.isChildMove(originalChange, previousChange)))
    )
      childrenMoves.push(previousChange)
  }
  return childrenMoves
}

const buildDescendantChange = (
  child /*: RemoteFileMove|RemoteDirMove|RemoteDescendantChange */,
  parent /*: RemoteDirMove|RemoteDescendantChange */
) /*: RemoteDescendantChange */ => {
  const descendantChange /*: RemoteDescendantChange */ = {
    sideName,
    type: 'DescendantChange',
    doc: _.clone(child.doc),
    was: _.clone(child.was),
    ancestorPath: parent.doc.path
  }
  if (child.type === 'FileMove') descendantChange.update = _.clone(child.update)

  return descendantChange
}

const buildMoveInsideMove = (
  child /*: RemoteFileMove|RemoteDirMove */,
  parent /*: RemoteDirMove|RemoteDescendantChange */
) /*: RemoteFileMove|RemoteDirMove */ => {
  const correctedSrc /*: Metadata */ = _.clone(child.was)
  correctedSrc.path = path.join(parent.doc.path, path.basename(child.was.path))

  if (child.type === 'FileMove') {
    return {
      sideName,
      type: 'FileMove',
      doc: _.clone(child.doc),
      was: correctedSrc,
      needRefetch: true
    }
  } else {
    return {
      sideName,
      type: 'DirMove',
      doc: _.clone(child.doc),
      was: correctedSrc,
      needRefetch: true
    }
  }
}

const squashedWithParent = (
  change,
  previousChanges /*: RemoteChange[] */,
  encounteredMoves /*: Array<RemoteDirMove|RemoteDescendantChange> */
) => {
  const { parentMove, squashedParentMove } = findParentMoves(
    change,
    previousChanges,
    encounteredMoves
  )

  // We found a parent move and it has been squashed with its own parent move
  if (parentMove && squashedParentMove) {
    if (remoteChange.isOnlyChildMove(parentMove, change)) {
      const descendantChange = buildDescendantChange(change, squashedParentMove)
      remoteChange.includeDescendant(squashedParentMove, descendantChange)
      encounteredMoves.push(_.cloneDeep(descendantChange))
      return descendantChange
    } else {
      encounteredMoves.push(_.cloneDeep(change))
      return buildMoveInsideMove(change, squashedParentMove)
    }
  }

  // We found an unsquashed parent move
  if (parentMove) {
    if (remoteChange.isOnlyChildMove(parentMove, change)) {
      const descendantChange = buildDescendantChange(change, parentMove)
      remoteChange.includeDescendant(parentMove, descendantChange)
      encounteredMoves.push(_.cloneDeep(descendantChange))
      return descendantChange
    } else {
      encounteredMoves.push(_.cloneDeep(change))
      return buildMoveInsideMove(change, parentMove)
    }
  }

  // We didn't find any parent move
  return change
}

const squashChildren = (
  change /*: RemoteDirMove|RemoteDescendantChange */,
  previousChanges /*: RemoteChange[] */,
  encounteredMoves /*: Array<RemoteDirMove|RemoteDescendantChange> */
) => {
  const originalChange = encounteredMoves.find(
    move => move.doc._id === change.doc._id
  )
  const childrenMoves = findChildrenMoves(
    change,
    originalChange,
    previousChanges
  )

  for (const childMove of childrenMoves) {
    if (
      remoteChange.isOnlyChildMove(change, childMove) ||
      (originalChange &&
        remoteChange.isOnlyChildMove(originalChange, childMove))
    ) {
      const descendantChange = buildDescendantChange(childMove, change)
      remoteChange.includeDescendant(change, descendantChange)
      // Child move is already in previousChanges and needs to be updated
      _.assign(childMove, descendantChange)
    } else {
      remoteChange.applyMoveInsideMove(change, childMove)
    }
    if (childMove.doc.docType === 'Folder')
      encounteredMoves.push(_.cloneDeep(childMove))
  }
}

const squashMoves = (
  doc /*: Metadata */,
  was /*: Metadata */,
  previousChanges /*: RemoteChange[] */,
  encounteredMoves /*: Array<RemoteDirMove|RemoteDescendantChange> */
) /*: RemoteDirMove|RemoteFileMove|RemoteDescendantChange */ => {
  const change = buildChange(sideName, doc, was)
  encounteredMoves.push(_.cloneDeep(change))

  // TODO: ignore descendants
  for (const previousChange of previousChanges) {
    if (
      previousChange.type === 'FileTrashing' &&
      change.type === 'FileMove' &&
      previousChange.was.path === change.doc.path
    ) {
      _.assign(previousChange, {
        type: 'IgnoredChange',
        detail: `File ${previousChange.was.path} overwritten by ${change.was.path}`
      })
      change.doc.overwrite = previousChange.was
      return change
    }

    if (
      previousChange.type === 'DirTrashing' &&
      change.type === 'DirMove' &&
      previousChange.was.path === change.doc.path
    ) {
      _.assign(previousChange, {
        type: 'IgnoredChange',
        detail: `Folder ${previousChange.was.path} overwritten by ${change.was.path}`
      })
      change.doc.overwrite = previousChange.was
      return change
    }
  }

  const squashedChange = squashedWithParent(
    change,
    previousChanges,
    encounteredMoves
  )

  if (
    squashedChange.type === 'DirMove' ||
    squashedChange.type === 'DescendantChange'
  ) {
    squashChildren(squashedChange, previousChanges, encounteredMoves)
  }

  return squashedChange
}

module.exports = squashMoves
