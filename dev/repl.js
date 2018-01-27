import 'source-map-support/register'

import { start } from 'repl'

import '../core/globals'
import App from '../core/app'
import { IntegrationTestHelpers } from '../test/helpers/integration'

const app = new App(process.env.COZY_DESKTOP_DIR)
const config = app.config
let cozy, helpers

console.log(`Welcome to the Cozy Desktop REPL!

The following objects are available:
  app      The cozy-desktop app
  config   Your active cozy-desktop configuration`)

if (config.isValid()) {
  app.instanciate()
  cozy = app.remote.watcher.remoteCozy.client
  helpers = new IntegrationTestHelpers(config, app.pouch, cozy)
  console.log(`  cozy     A cozy-client-js instance, set up with your config
  helpers  See test/helpers/integration.js

Since a valid configuration is available, app.instanciate() was already called
for you, which means you can call app.startSync().`)
} else {
  console.log(`
No valid configuration found.
Skipping app instanciation and cozy / helpers setup.`)
}

console.log(`
Press CTRL+D to exit`)

let repl = start()
const defaultEval = repl.eval

repl.eval = function customEval (cmd, context, filename, callback) {
  defaultEval(cmd, context, filename, (err, result) => {
    if (result instanceof Promise) {
      result.then(console.log).catch(console.error)
      result = undefined
    }
    callback(err, result)
  })
}

Object.assign(repl.context, {
  app,
  config,
  cozy,
  helpers
})
