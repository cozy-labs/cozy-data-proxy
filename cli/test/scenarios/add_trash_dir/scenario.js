module.exports = {
  actions: [
    {type: 'mkdir', path: 'dir'},
    {type: 'wait', ms: 1500},
    {type: 'trash', path: 'dir'}
  ],
  expected: {
    prepCalls: [],
    tree: [],
    remoteTrash: []
  }
}
