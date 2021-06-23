/**
 * @module core/remote/constants
 * @see https://github.com/cozy/cozy-stack/blob/master/pkg/consts/consts.go
 * @flow
 */

/*::
export type FILE_TYPE = 'file'
export type DIR_TYPE = 'directory'
export type FILES_DOCTYPE = 'io.cozy.files'
*/

const DEFAULT_HEARTBEAT = 1000 * 60 // 1 minute

module.exports = {
  // Doctypes
  FILES_DOCTYPE: 'io.cozy.files',
  OAUTH_CLIENTS_DOCTYPE: 'io.cozy.oauth.clients',

  // Files document type
  DIR_TYPE: 'directory',
  FILE_TYPE: 'file',

  // Special document ids
  ROOT_DIR_ID: 'io.cozy.files.root-dir',
  TRASH_DIR_ID: 'io.cozy.files.trash-dir',

  TRASH_DIR_NAME: '.cozy_trash',

  // Special MIME types
  NOTE_MIME_TYPE: 'text/vnd.cozy.note+markdown',

  // Remote watcher changes fetch interval
  HEARTBEAT: parseInt(process.env.COZY_DESKTOP_HEARTBEAT) || DEFAULT_HEARTBEAT,

  // ToS updated warning code
  TOS_UPDATED_WARNING_CODE: 'tos-updated'
}
