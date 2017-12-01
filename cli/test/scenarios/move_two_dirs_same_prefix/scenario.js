/* @flow */

import type { Scenario } from '..'

module.exports = ({
  init: [
    {ino: 1, path: 'src/'},
    {ino: 2, path: 'src/dir1/'},
    {ino: 3, path: 'src/dir12/'},
    {ino: 4, path: 'dst/'}
  ],
  actions: [
    {type: 'mv', src: 'src/dir1', dst: 'dst/dir1'},
    {type: 'wait', ms: 1500},
    {type: 'mv', src: 'src/dir12', dst: 'dst/dir12'}
  ],
  expected: {
    prepCalls: [
      {method: 'moveFolderAsync', src: 'src/dir1', dst: 'dst/dir1'},
      {method: 'moveFolderAsync', src: 'src/dir12', dst: 'dst/dir12'}
    ],
    tree: [
      'dst/',
      'dst/dir1/',
      'dst/dir12/',
      'src/'
    ],
    remoteTrash: []
  }
}: Scenario)
