/**
 * @module gui/notes
 * @flow
 */

const path = require('path')
const { default: CozyClient, models } = require('cozy-client')

const metadata = require('../../core/metadata')
const {
  CozyDocumentMissingError,
  UnreachableError
} = require('../../core/remote/errors')

const logger = require('../../core/utils/logger')
const log = logger({
  component: 'Notes'
})

/*::
import { Shell } from 'electron'
import { App } from '../../core/app'
import { Config } from '../../core/config'
import { Pouch } from '../../core/pouch'
import { Remote } from '../../core/remote'
import type { Metadata } from '../../core/metadata'
import type { RemoteDoc } from '../../core/remote/document'
*/

const localDoc = async (
  filePath /*: string */,
  { config, pouch } /*: { config: Config, pouch: Pouch } */
) /*: Promise<Metadata> */ => {
  const relPath = path.relative(config.syncPath, filePath)
  const doc = await pouch.byIdMaybe(metadata.id(relPath))
  if (!doc || doc.deleted) {
    throw new CozyDocumentMissingError({
      cozyURL: config.cozyUrl,
      doc: { name: path.basename(relPath) }
    })
  }
  return doc
}

const remoteDoc = async (
  localDoc /*: Metadata */,
  { config, remote } /*: { config: Config, remote: Remote } */
) /*: Promise<RemoteDoc> */ => {
  try {
    return await remote.remoteCozy.find(localDoc.remote._id)
  } catch (err) {
    if (err.name === 'FetchError' && err.status === 404) {
      throw new CozyDocumentMissingError({
        cozyURL: config.cozyUrl,
        doc: { name: path.basename(localDoc.path) }
      })
    }
    throw err
  }
}

const getCozyClient = async (desktop /*: App */) /*: CozyClient */ => {
  await desktop.remote.remoteCozy.client.authorize()
  return await CozyClient.fromOldOAuthClient(desktop.remote.remoteCozy.client)
}

const openNote = async (
  filePath /*: string */,
  { shell, desktop } /*: { shell: Shell, desktop: App } */
) => {
  try {
    let note = await localDoc(filePath, desktop)
    log.info({ note }, 'note object')

    const client = await getCozyClient(desktop)
    if (!client) {
      throw new UnreachableError({
        cozyURL: desktop.config.cozyUrl
      })
    }

    const noteURL = await models.note.fetchURL(client, { id: note.remote._id })
    log.info({ noteURL }, 'computed url')
    shell.openExternal(noteURL)
  } catch (err) {
    log.error({ err, path: filePath }, 'could not open note')

    if (err.name === 'FetchError') {
      if (err.status === 403 || err.status === 404) {
        throw new CozyDocumentMissingError({
          cozyURL: desktop.config.cozyUrl,
          doc: { name: path.basename(filePath) }
        })
      } else {
        throw new UnreachableError({
          cozyURL: desktop.config.cozyUrl
        })
      }
    } else {
      throw err
    }
  }
}

module.exports = { localDoc, remoteDoc, openNote }
