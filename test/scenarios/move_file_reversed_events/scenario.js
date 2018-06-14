/* @flow */

/*:: import type { Scenario } from '..' */

module.exports = ({
  init: [
    { ino: 1, path: 'dst/' },
    { ino: 2, path: 'src/' },
    { ino: 3, path: 'src/file' }
  ],
  actions: [
    {type: 'mv', src: 'src/file', dst: 'dst/file'}
  ],
  expected: {
    prepCalls: [
      {method: 'moveFileAsync', dst: 'dst/file', src: 'src/file'}
    ],
    tree: [
      'dst/',
      'dst/file',
      'src/'
    ],
    remoteTrash: []
  }
} /*: Scenario */)
