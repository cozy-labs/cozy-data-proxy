const WindowManager = require('./window_manager')
const {autoUpdater} = require('electron-updater')

const log = require('cozy-desktop').default.logger({
  component: 'GUI:autoupdater'
})

const UPDATE_CHECK_TIMEOUT = 5000

module.exports = class UpdaterWM extends WindowManager {
  windowOptions () {
    return {
      title: 'UPDATER',
      width: 500,
      height: 400
    }
  }

  constructor (...opts) {
    autoUpdater.on('update-available', (info) => {
      this.clearTimeoutIfAny()
      log.info({update: info, skipped: this.skipped}, 'Update available')
      // Make sure UI don't show up in front of onboarding after timeout
      if (!this.skipped) this.show()
    })
    autoUpdater.on('update-not-available', (info) => {
      log.info({update: info}, 'No update available')
      this.afterUpToDate()
    })
    autoUpdater.on('error', (err) => {
      log.error({err}, 'Error in auto-updater! ')
      // May happen in dev because of code signature error. Not really an issue.
      this.afterUpToDate()
    })
    autoUpdater.on('download-progress', (progressObj) => {
      log.trace({progress: progressObj}, 'Downloading...')
      this.send('update-downloading', progressObj)
    })
    autoUpdater.on('update-downloaded', (info) => {
      log.info({update: info}, 'Update downloaded. Exit and install...')
      autoUpdater.quitAndInstall()
    })

    super(...opts)
  }

  clearTimeoutIfAny () {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  onUpToDate (handler) {
    this.afterUpToDate = () => {
      this.clearTimeoutIfAny()
      handler()
    }
  }

  checkForUpdates () {
    if (process.platform === 'linux') {
      log.warn(`Not looking for updates on ${process.platform}.`)
      this.afterUpToDate()
      return Promise.resolve()
    } else {
      log.info('Looking for updates...')
      this.timeout = setTimeout(() => {
        log.warn({timeout: UPDATE_CHECK_TIMEOUT}, 'Updates check is taking too long')
        this.skipped = true

        // Disable handler & warn on future calls
        const handler = this.afterUpToDate
        this.afterUpToDate = () => {}

        handler()
      }, UPDATE_CHECK_TIMEOUT)
      autoUpdater.checkForUpdates()
    }
  }

  hash () {
    return '#updater'
  }

  ipcEvents () { return {} }
}
