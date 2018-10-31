/* @flow */

const _ = require('lodash')
const { clone } = _
const mime = require('mime')
const deepDiff = require('deep-diff').diff
const path = require('path')
const { join } = path

const logger = require('./logger')
const { detectPathIssues, detectPathLengthIssue } = require('./path_restrictions')
const { maxDate } = require('./timestamp')

/*::
import type fs from 'fs'
import type { PathIssue } from './path_restrictions'
*/

const log = logger({
  component: 'Metadata'
})

const { platform } = process

/*::
export type SideName =
  | "local"
  | "remote";

export type MetadataRemoteInfo = {
  _id: string,
  _rev: string
}

export type MetadataSidesInfo = {
  remote?: number,
  local?: number
}

// The files/dirs metadata, as stored in PouchDB
export type Metadata = {
  _deleted?: true,
  _id: string,
  _rev?: string,
  md5sum?: string,
  class?: string,
  docType: string,
  errors?: number,
  executable?: true,
  updated_at: string|Date,
  mime?: string,
  moveTo?: string, // Destination id
  overwrite?: Metadata,
  childMove?: boolean,
  path: string,
  remote: MetadataRemoteInfo,
  size?: number,
  tags?: string[],
  sides: MetadataSidesInfo,
  trashed?: true,
  incompatibilities?: *,
  ino?: ?number,
  moveFrom?: Metadata
}
*/

let id /*: string => string */ = (_) => ''

// See [test/world/](https://github.com/cozy-labs/cozy-desktop/blob/master/test/world/)
// for file system behavior examples.
switch (platform) {
  case 'linux': case 'freebsd': case 'sunos':
    id = idUnix
    break
  case 'darwin':
    id = idApfsOrHfs
    break
  case 'win32':
    id = idNTFS
    break
  default:
    throw new Error(`Sorry, ${platform} is not supported!`)
}

module.exports = {
  assignId,
  assignMaxDate,
  assignPlatformIncompatibilities,
  isFile,
  id,
  invalidPath,
  invariants,
  ensureValidPath,
  detectPlatformIncompatibilities,
  invalidChecksum,
  ensureValidChecksum,
  extractRevNumber,
  isUpToDate,
  markAsUpToDate,
  sameFolder,
  sameFile,
  sameFileIgnoreRev,
  sameBinary,
  markSide,
  buildDir,
  buildFile
}

function isFile (doc /*: Metadata */) /*: bool */ {
  return doc.docType === 'file'
}

// Build an _id from the path for a case sensitive file system (Linux, BSD)
function idUnix (fpath /*: string */) {
  return fpath
}

// Build an _id from the path for macOS, assuming file system is either APFS
// or HFS+.
//
// APFS:
// - case preservative, but not case sensitive
// - unicode normalization preservative, but not sensitive
//
// HFS+:
// - case preservative, but not case sensitive
// - unicode NFD normalization (sort of)
//
// See https://nodejs.org/en/docs/guides/working-with-different-filesystems/
// for why toUpperCase is better than toLowerCase
//
// We are using NFD (Normalization Form Canonical Decomposition), but NFC
// would be fine too. We just need to make sure that 2 files which cannot
// coexist on APFS or HFS+ have the same identity.
//
// Note: String.prototype.normalize is not available on node 0.10 and does
// nothing when node is compiled without intl option.
function idApfsOrHfs (fpath /*: string */) {
  let id = fpath
  if (id.normalize) { id = id.normalize('NFD') }
  return id.toUpperCase()
}

// Build an _id from the path for Windows (NTFS file system)
function idNTFS (fpath /*: string */) {
  return fpath.toUpperCase()
}

// Assign an Id to a document
function assignId (doc /*: any */) {
  doc._id = id(doc.path)
}

// Return true if the document has not a valid path
// (ie a path inside the mount point).
// Normalizes the path as a side-effect.
// TODO: Separate normalization (side-effect) from validation (pure).
function invalidPath (doc /*: {path: string} */) {
  if (!doc.path) { return true }
  doc.path = path.normalize(doc.path)
  if (doc.path.startsWith(path.sep)) {
    doc.path = doc.path.slice(1)
  }
  let parts = doc.path.split(path.sep)
  return (doc.path === '.') ||
          (doc.path === '') ||
          (parts.indexOf('..') >= 0)
}

// Same as invalidPath, except it throws an exception when path is invalid.
function ensureValidPath (doc /*: {path: string} */) {
  if (invalidPath(doc)) {
    log.warn({path: doc.path}, `Invalid path: ${JSON.stringify(doc, null, 2)}`)
    throw new Error('Invalid path')
  }
}

function invariants (doc /*: Metadata */) {
  let err
  if (!doc.sides) {
    err = new Error(`${doc._id} has no sides`)
  } else if (doc.sides.remote && !doc.remote) {
    err = new Error(`${doc._id} has 'sides.remote' but no remote`)
  } else if (doc.docType === 'file' && doc.md5sum == null) {
    err = new Error(`${doc._id} is a file without checksum`)
  }

  if (err) {
    log.error({err, sentry: true}, err.message)
    throw err
  }

  return doc
}

/*::
export type PlatformIncompatibility = PathIssue & {docType: string}
*/

// Identifies platform incompatibilities in metadata that will prevent local
// synchronization
// TODO: return null instead of an empty array when no issue was found?
function detectPlatformIncompatibilities (metadata /*: Metadata */, syncPath /*: string */) /*: Array<PlatformIncompatibility> */ {
  const {path, docType} = metadata
  const pathLenghIssue = detectPathLengthIssue(join(syncPath, path), platform)
  const issues /*: PathIssue[] */ = detectPathIssues(path, docType)
  if (pathLenghIssue) issues.unshift(pathLenghIssue)
  return issues.map(issue => (_.merge({
    docType: issue.path === path ? docType : 'folder'
  }, issue)))
}

function assignPlatformIncompatibilities (doc /*: Metadata */, syncPath /*: string */) /*: void */ {
  const incompatibilities = detectPlatformIncompatibilities(doc, syncPath)
  if (incompatibilities.length > 0) doc.incompatibilities = incompatibilities
}

// Return true if the checksum is invalid
// If the checksum is missing, it is invalid.
// MD5 has 16 bytes.
// Base64 encoding must include padding.
function invalidChecksum (doc /*: Metadata */) {
  if (doc.md5sum == null) return doc.docType === 'file'

  const buffer = Buffer.from(doc.md5sum, 'base64')

  return buffer.byteLength !== 16 ||
    buffer.toString('base64') !== doc.md5sum
}

function ensureValidChecksum (doc /*: Metadata */) {
  if (invalidChecksum(doc)) {
    log.warn({path: doc.path, doc}, 'Invalid checksum')
    throw new Error('Invalid checksum')
  }
}

// Extract the revision number, or 0 it not found
function extractRevNumber (doc /*: Metadata|{_rev: string} */) {
  try {
    // $FlowFixMe
    let rev = doc._rev.split('-')[0]
    return Number(rev)
  } catch (error) {
    return 0
  }
}

// Return true if the remote file is up-to-date for this document
function isUpToDate (side /*: SideName */, doc /*: Metadata */) {
  let currentRev = doc.sides[side] || 0
  let lastRev = extractRevNumber(doc)
  return currentRev === lastRev
}

function markAsUpToDate (doc /*: Metadata */) {
  let rev = extractRevNumber(doc) + 1
  for (let s of ['local', 'remote']) {
    doc.sides[s] = rev
  }
  delete doc.errors
  return rev
}

// Ensure new timestamp is never older than the previous one
function assignMaxDate (doc /*: Metadata */, was /*: ?Metadata */) {
  if (was == null) return
  const wasUpdatedAt = new Date(was.updated_at)
  const docUpdatedAt = new Date(doc.updated_at)
  if (docUpdatedAt < wasUpdatedAt) { doc.updated_at = was.updated_at }
}

const ensureExecutable = (one, two) => {
  two = process.platform === 'win32'
    ? _.defaults({executable: one.executable}, two)
    : two
  return [
    _.merge({executable: !!one.executable}, one),
    _.merge({executable: !!two.executable}, two)
  ]
}

const makeComparator = (name, interestingFields) => {
  const interestingPaths = interestingFields.map(f => f.split('.'))
  const filter = (path, key) => {
    return !interestingPaths.some(interestingPath => {
      return interestingPath.every((part, i) => {
        if (i < path.length) return path[i] === part
        if (i === path.length) return key === part
        return true
      })
    })
  }
  return (one, two) => {
    const diff = deepDiff(one, two, filter)
    log.trace({path: two.path, diff}, name)
    return !diff
  }
}

const sameFolderComparator = makeComparator('sameFolder',
  ['path', 'docType', 'remote', 'tags', 'trashed', 'ino'])

// Return true if the metadata of the two folders are the same
function sameFolder (one /*: Metadata */, two /*: Metadata */) {
  return sameFolderComparator(one, two)
}

const sameFileComparator = makeComparator('sameFile',
  ['path', 'docType', 'md5sum', 'remote._id', 'remote._rev',
    'tags', 'size', 'trashed', 'ino', 'executable'])

const sameFileIgnoreRevComparator = makeComparator('sameFileIgnoreRev',
  ['path', 'docType', 'md5sum', 'remote._id',
    'tags', 'size', 'trashed', 'ino', 'executable'])

// Return true if the metadata of the two files are the same
function sameFile (one /*: Metadata */, two /*: Metadata */) {
  [one, two] = ensureExecutable(one, two)
  return sameFileComparator(one, two)
}

// Return true if the metadata of the two files are the same,
// ignoring revision
function sameFileIgnoreRev (one /*: Metadata */, two /*: Metadata */) {
  [one, two] = ensureExecutable(one, two)
  return sameFileIgnoreRevComparator(one, two)
}

// Return true if the two files have the same binary content
function sameBinary (one /*: Metadata */, two /*: Metadata */) {
  return one.md5sum === two.md5sum
}

// Mark the next rev for this side
//
// To track which side has made which modification, a revision number is
// associated to each side. When a side make a modification, we extract the
// revision from the previous state, increment it by one to have the next
// revision and associate this number to the side that makes the
// modification.
function markSide (side /*: string */, doc /*: Metadata */, prev /*: ?Metadata */) /*: Metadata */ {
  let rev = 0
  if (prev) { rev = extractRevNumber(prev) }
  if (doc.sides == null) {
    const was = prev && prev.sides
    doc.sides = clone(was || {})
  }
  doc.sides[side] = ++rev
  return doc
}

function buildDir (fpath /*: string */, stats /*: fs.Stats */, remote /*: ?MetadataRemoteInfo */) /*: Metadata */ {
  const doc /*: Object */ = {
    _id: id(fpath),
    path: fpath,
    docType: 'folder',
    updated_at: maxDate(stats.mtime, stats.ctime),
    ino: stats.ino,
    sides: {},
    remote
  }
  return doc
}

const EXECUTABLE_MASK = 1 << 6

function buildFile (filePath /*: string */, stats /*: fs.Stats */, md5sum /*: string */, remote /*: ?MetadataRemoteInfo */) /*: Metadata */ {
  const mimeType = mime.lookup(filePath)
  const {mtime, ctime} = stats
  let doc /*: Object */ = {
    _id: id(filePath),
    path: filePath,
    docType: 'file',
    md5sum,
    ino: stats.ino,
    updated_at: maxDate(mtime, ctime),
    mime: mimeType,
    class: mimeType.split('/')[0],
    size: stats.size,
    remote
  }
  if ((stats.mode & EXECUTABLE_MASK) !== 0) { doc.executable = true }
  return doc
}
