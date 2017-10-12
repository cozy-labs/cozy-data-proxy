module.exports = {
  init: [
    {ino: 1, path: 'dst1/'},
    {ino: 2, path: 'dst2/'},
    {ino: 3, path: 'src/'},
    {ino: 4, path: 'src/file'}
  ],
  actions: [
    {type: 'mv', src: 'src/file', dst: 'dst1/file'},
    {type: 'wait', ms: 1500},
    {type: 'mv', src: 'dst1/file', dst: 'dst2/file'}
  ],
  expected: {
    prepCalls: [
      {method: 'moveFileAsync', dst: 'dst2/file', src: 'src/file'}
    ]
  }
}
