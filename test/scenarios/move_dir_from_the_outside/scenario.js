/* @flow */

/*:: import type { Scenario } from '..' */

module.exports = ({
  init: [
    {ino: 1, path: 'dst/'},
    {ino: 2, path: '../outside/dir/'},
    {ino: 3, path: '../outside/dir/empty-subdir/'},
    {ino: 4, path: '../outside/dir/subdir/'},
    {ino: 5, path: '../outside/dir/subdir/file'}
  ],
  actions: [
    {type: 'mv', src: '../outside/dir', dst: 'dst/dir'}
  ],
  expected: {
    tree: [
      'dst/',
      'dst/dir/',
      'dst/dir/empty-subdir/',
      'dst/dir/subdir/',
      'dst/dir/subdir/file'
    ],
    remoteTrash: []
  }
} /*: Scenario */)
