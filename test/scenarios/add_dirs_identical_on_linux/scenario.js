/* eslint-disable no-multi-spaces */
/* @flow */

/*:: import type { Scenario } from '..' */

module.exports = ({
  platforms: ['linux'],
  actions: [
    {type: 'mkdir', path: 'JOHN'},
    {type: 'mkdir', path: 'JOHN/exact-same-subdir'},
    {type: '>',     path: 'JOHN/exact-same-subdir/a.txt'},
    {type: '>',     path: 'JOHN/exact-same-subdir/b.txt'},
    {type: 'mkdir', path: 'JOHN/other-subdir-JOHN-1'},
    {type: 'mkdir', path: 'john'},
    {type: 'mkdir', path: 'john/exact-same-subdir'},
    {type: '>',     path: 'john/exact-same-subdir/a.txt'},
    {type: '>',     path: 'john/exact-same-subdir/b.txt'},
    {type: 'mkdir', path: 'john/other-subdir-john-2'}
    // TODO:
    // {type: 'mkdir', path: 'JOHN/IDENTICAL-SUBDIR'},
    // {type: 'mkdir', path: 'john/identical-subdir'},
  ],
  expected: {
    tree: [
      'JOHN/',
      'JOHN/exact-same-subdir/',
      'JOHN/exact-same-subdir/a.txt',
      'JOHN/exact-same-subdir/b.txt',
      'JOHN/other-subdir-JOHN-1/',
      'john/',
      'john/exact-same-subdir/',
      'john/exact-same-subdir/a.txt',
      'john/exact-same-subdir/b.txt',
      'john/other-subdir-john-2/'
    ],
    remoteTrash: []
  }
} /*: Scenario */)
