module.exports = {
  init: [
    {ino: 1, path: 'dst/'},
    {ino: 2, path: 'src/'},
    {ino: 3, path: 'src/file'}
  ],
  actions: [
    {type: 'mv', src: 'src/file', dst: 'dst/file'},
    {type: 'wait', ms: 1500},
    {type: 'rm', path: 'dst/file'}
  ],
  expected: {
    prepCalls: [
      {method: 'trashFileAsync', path: 'src/file'}
    ]
  }
}
