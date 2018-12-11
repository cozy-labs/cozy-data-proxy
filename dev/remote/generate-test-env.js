require('../../core/globals')
const cozy = require('cozy-client-js')
const fse = require('fs-extra')

const pkg = require('../../package.json')
const automatedRegistration = require('./automated_registration')

const cozyUrl = chooseCozyUrl(process.env.BUILD_JOB)
const passphrase = process.env.COZY_PASSPHRASE
const storage = new cozy.MemoryStorage()

function chooseCozyUrl (buildJob) {
  return buildJob === 'scenarios_build'
    ? process.env.COZY_URL_2
    : process.env.COZY_URL_1
}

function readAccessToken () {
  console.log('Read access token...')
  return storage.load('creds')
    .then(creds => creds.token.accessToken)
}

function generateTestEnv (accessToken) {
  console.log('Generate .env.test file...')
  return fse.writeFile('.env.test', `
COZY_DESKTOP_HEARTBEAT=1000
COZY_STACK_TOKEN=${accessToken}
COZY_URL=${cozyUrl}
NODE_ENV=test
  `)
}

automatedRegistration(cozyUrl, passphrase, storage)
  .process(pkg)
  .then(readAccessToken)
  .then(generateTestEnv)
  .then(() => {
    console.log('Remote bootstrap complete.')
    process.exit(0) // eslint-disable-line no-process-exit
  })
  .catch(err => {
    console.error(err)
    process.exit(1) // eslint-disable-line no-process-exit
  })
