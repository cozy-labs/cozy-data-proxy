const http = require('http')

// A fake HTTP server, to be used in place of the cozy-stack for integration
// testing purpose (e.g. to simulate failures).
module.exports = class CozyStackDouble {
  constructor() {
    this.clearStub()
    this.sockets = []

    this.hostname = 'localhost'
    this.port = 9090
    this.server = http.createServer((...args) => this._stub(...args))
    this.server.on('connection', socket => this.sockets.push(socket))
  }

  // The URL for RemoteCozy constructor
  url() {
    return `http://${this.hostname}:${this.port}`
  }

  // Stub the Cozy stack response.
  //
  // For callback signature, see:
  // https://nodejs.org/docs/latest-v4.x/api/http.html#http_event_request
  stub(callback) {
    this._stub = callback
  }

  // Throw an error in case you forgot to call stub() before sending an
  // HTTP request to the cozy-stack double.
  clearStub() {
    this._stub = () => {
      throw new Error("You didn't stub the cozy-stack response")
    }
  }

  // Returns a promise that resolves as soon as the server is listening.
  start() {
    return new Promise(resolve => {
      this.server.listen(this.port, this.hostname, resolve)
    })
  }

  // Returns a promise that resolves as soon as the server is not listening.
  stop() {
    return new Promise(resolve => {
      this.sockets.forEach(socket => socket.destroy())
      this.server.close(resolve)
    })
  }
}
