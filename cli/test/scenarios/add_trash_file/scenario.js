module.exports = {
  actions: [
    {type: '>', path: 'file'},
    {type: 'wait', ms: 1500},
    {type: 'trash', path: 'file'}
  ],
  expected: {
    prepCalls: [],
    tree: [],
    remoteTrash: []
  }
}
