const lnk = require('lnk')
const os = require('os')
const path = require('path')
const childProcess = require('child_process')

const log = require('../../core/app').logger({
  component: 'GUI'
})

const platform = process.platform
const major = Number.parseInt(os.release().split('.')[0])
const winLinksDir = path.join(os.homedir(), 'Links')

const win10PinToHome = (path) => {
  const escapedPath = path.replace(/'/g, "''")
  execSync(`powershell -Command "(New-Object -COM shell.application).Namespace('${escapedPath}').Self.InvokeVerb('pintohome')"`)
}

const winAddLink = (path) => {
  lnk.sync([path], winLinksDir)
}

// Execute a command synchronously and log both input and output.
const execSync = (cmd) => {
  log.debug(`+ ${cmd}`)
  const output = childProcess.execSync(cmd, {encoding: 'utf8'})
  log.debug(output)
}

const favoriteBin = path.resolve(__dirname, '../../macos/favorite/.build/favorite')

function quotePath (path) {
  return `"${path.replace(/"/g, '\\"')}"`
}

const macAddFavorite = (path) => {
  execSync(`${quotePath(favoriteBin)} ${quotePath(path)}`)
}

// For Darwin <=> macOS version mapping, see:
//   https://en.wikipedia.org/wiki/Darwin_(operating_system)#Release_history
//
// For Windows <=> NT kernel version mapping, see:
//   https://msdn.microsoft.com/en-us/library/windows/desktop/ms724832(v=vs.85).aspx
//   https://en.wikipedia.org/wiki/List_of_Microsoft_Windows_versions
module.exports.addFileManagerShortcut = (config) => {
  if (platform === 'win32' && major >= 10) {
    win10PinToHome(config.syncPath)
  } else if (platform === 'win32' && major >= 6) {
    winAddLink(config.syncPath)
  } else if (platform === 'darwin' && major >= 14) {
    // Embedded binary requires at least 10.10 (Yosemite)
    macAddFavorite(config.syncPath)
  } else {
    throw new Error(`Not registering shortcut on ${platform} ${major}`)
  }
}
