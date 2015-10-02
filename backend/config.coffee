path      = require 'path-extra'
fs        = require 'fs-extra'
touch     = require 'touch'
process   = require 'process'
request   = require 'request-json-light'
urlParser = require 'url'
log       = require('printit')
    prefix: 'Config        '


module.exports = config =

    # Create config file if it doesn't exist.
    # DEFAULT_DIR var is used in case of tests.
    init: ->
        basePath = process.env.DEFAULT_DIR or path.homedir()
        defaultDir = path.join basePath, '.cozy-desktop'
        @configPath = path.join path.resolve(defaultDir), 'config.json'
        fs.ensureDirSync defaultDir
        fs.ensureFileSync @configPath

        if fs.readFileSync(@configPath).toString() is ''
            fs.writeFileSync @configPath, JSON.stringify devices: {}, null, 2

        @dir = defaultDir
        @dbPath = path.join defaultDir, 'db'
        @config = require @configPath

    # Return config related to device name.
    getConfig: (deviceName) ->
        deviceName ?= @getDeviceName()

        if @config.devices[deviceName]?
            # TODO clone the config before returning it
            # to avoid mutation from outside this module
            return @config.devices[deviceName]
        else if Object.keys(@config.devices).length is 0
            return {} # No device configured
        else
            log.error "Device not set locally: #{deviceName}"
            throw new Error "Device not set locally: #{deviceName}"

    # Get the argument after -d or --deviceName
    # Or return the first device name
    getDeviceName: ->
        for arg, index in process.argv
            if arg is '-d' or arg is '--deviceName'
                return process.argv[index + 1]

        return Object.keys(@config.devices)[0]

    # Add remote configuration for a given device name.
    addRemoteCozy: (options) ->
        @config.devices ?= {}
        @config.devices[options.deviceName] = options
        @saveConfig()

    # Remove remote configuration for a given device name.
    removeRemoteCozy: (deviceName) ->
        @config.devices ?= {}
        delete @config.devices[deviceName]
        @saveConfig()

    # Save configuration to file system.
    saveConfig: ->
        fs.writeFileSync config.configPath, JSON.stringify @config, null, 2

    # Set last remote replication sequence in the configuration file.
    setRemoteSeq: (seq, deviceName) ->
        deviceName ?= @getDeviceName()
        @config.devices[deviceName].remoteSeq = seq
        @saveConfig()

    # Get last remote replication sequence from the configuration file.
    getRemoteSeq: (deviceName) ->
        deviceName ?= @getDeviceName()
        if @config.devices[deviceName].remoteSeq
            return @config.devices[deviceName].remoteSeq
        else
            @setRemoteSeq 0, deviceName
            return 0

    # Set last remote replication sequence in the configuration file.
    setLocalSeq: (seq, deviceName) ->
        deviceName ?= @getDeviceName()
        @config.devices[deviceName].localSeq = seq
        @saveConfig()

    # Get last remote replication sequence from the configuration file.
    getLocalSeq: (deviceName) ->
        deviceName ?= @getDeviceName()
        if @config.devices[deviceName].localSeq
            return @config.devices[deviceName].localSeq
        else
            @setLocalSeq 0, deviceName
            return 0

    # Get Couch URL for given device name.
    getUrl: (deviceName) ->
        deviceName ?= @getDeviceName()
        remoteConfig = @getConfig(deviceName)
        if remoteConfig.url?
            url = urlParser.parse remoteConfig.url
            url.auth = "#{deviceName}:#{remoteConfig.devicePassword}"
            url = "#{urlParser.format(url)}cozy"
        else
            null

    # Update synchronously configuration for given device.
    updateSync: (deviceConfig) ->
        device = @getConfig()
        for key, value of deviceConfig
            device[key] = deviceConfig[key]
        @config.devices[device.deviceName] = device

        fs.writeFileSync config.configPath, JSON.stringify @config, null, 2
        log.info 'Configuration file successfully updated'

    setInsecure: (bool) ->
        @config.insecure = bool
        @saveConfig()
        @config

    augmentPouchOptions: (options) ->
        if @config.insecure
            options.ajax =
                rejectUnauthorized: false
                requestCert: true
                agent: false
        options

config.init()
