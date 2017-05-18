/* @flow weak */

import bunyan from 'bunyan'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'

const LOG_DIR = path.join(process.env.COZY_DESKTOP_DIR || os.homedir(), '.cozy-desktop')
const LOG_FILE = path.join(LOG_DIR, 'logs.txt')

fs.ensureDirSync(LOG_DIR)

export const defaultLogger = bunyan.createLogger({
  name: 'Cozy Desktop',
  level: 'trace',
  serializers: {
    err: bunyan.stdSerializers.err
  },
  streams: [
    {
      type: 'rotating-file',
      path: LOG_FILE,
      period: '1d',
      count: 7
    }
  ]
})

if (process.env.DEBUG) {
  defaultLogger.addStream({
    stream: process.stdout,
    level: 'trace'
  })
}

function logger (options) {
  return defaultLogger.child(options)
}

export default logger
