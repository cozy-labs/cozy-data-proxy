/* @flow */
/* eslint-env mocha */

const crypto = require('crypto')
const EventEmitter = require('events')
const fs = require('fs-extra')
const { pick } = require('lodash')
const path = require('path')
const sinon = require('sinon')
const should = require('should')

const conversion = require('../../../core/conversion')
const { ensureValidPath } = require('../../../core/metadata')
const Prep = require('../../../core/prep')
const Remote = require('../../../core/remote')
const { TRASH_DIR_ID } = require('../../../core/remote/constants')
const timestamp = require('../../../core/timestamp')

const MetadataBuilders = require('../../support/builders/metadata')
const configHelpers = require('../../support/helpers/config')
const pouchHelpers = require('../../support/helpers/pouch')
const {
  cozy, builders, deleteAll, createTheCouchdbFolder
} = require('../../support/helpers/cozy')

const metadataBuilders = new MetadataBuilders()

/*::
import type { Metadata } from '../../../core/metadata'
import type { RemoteDoc, JsonApiDoc } from '../../../core/remote/document'
*/

describe('Remote', function () {
  before('instanciate config', configHelpers.createConfig)
  before('register OAuth client', configHelpers.registerClient)
  before('instanciate pouch', pouchHelpers.createDatabase)
  before('instanciate remote', function () {
    this.prep = sinon.createStubInstance(Prep)
    this.events = new EventEmitter()
    this.remote = new Remote(this.config, this.prep, this.pouch, this.events)
  })
  beforeEach(deleteAll)
  beforeEach(createTheCouchdbFolder)
  after('clean pouch', pouchHelpers.cleanDatabase)
  after('clean config directory', configHelpers.cleanConfig)

  describe('constructor', () =>
    it('has a remoteCozy and a watcher', function () {
      should.exist(this.remote.remoteCozy)
      should.exist(this.remote.watcher)
    })
  )

  describe('createReadStream', () =>
    it('create a readable stream from a remote binary', function (done) {
      const expectedChecksum = '2NqmrnZqa1zTER40NtPGJg=='
      const fixture = 'test/fixtures/cool-pillow.jpg'

      builders.remote.file().named('pillow.jpg').contentType('image/jpeg')
        .dataFromFile(fixture).create()
        .then(binary => {
          should(binary.md5sum).equal(expectedChecksum)
          this.remote.createReadStreamAsync(conversion.createMetadata(binary)).then((stream) => {
            should.exist(stream)
            const checksum = crypto.createHash('md5')
            checksum.setEncoding('base64')
            stream.pipe(checksum)
            stream.on('end', function () {
              checksum.end()
              should.equal(expectedChecksum, checksum.read())
              done()
            })
          })
        })
        .catch(done)
    })
  )

  describe('addFileAsync', function () {
    it('adds a file to the remote Cozy', async function () {
      const doc /*: Object */ = {
        _id: 'cat2.jpg',
        path: 'cat2.jpg',
        docType: 'file',
        md5sum: 'fc7e0b72b8e64eb05e05aef652d6bbed950f85df',
        class: 'image',
        executable: true,
        updated_at: timestamp.current(),
        mime: 'image/jpg',
        size: 36901,
        sides: {
          local: 1
        }
      }
      await this.pouch.db.put(doc)

      this.remote.other = {
        createReadStreamAsync (localDoc) {
          const stream = fs.createReadStream('test/fixtures/chat-mignon-mod.jpg')
          return Promise.resolve(stream)
        }
      }

      const created = await this.remote.addFileAsync(doc)
      should.exist(doc.remote._id)
      should.exist(doc.remote._rev)

      const file = await cozy.files.statById(created.remote._id)
      should(file.attributes).have.properties({
        dir_id: 'io.cozy.files.root-dir',
        executable: true,
        mime: 'image/jpg',
        name: 'cat2.jpg',
        size: '36901',
        type: 'file',
        updated_at: timestamp.stringify(doc.updated_at)
      })
    })

    it('does not reupload an existing file', async function () {
      const backupDir = await builders.remote.dir().named('backup').inRootDir().create()
      await builders.remote.dir().named('ORIGINAL').inRootDir().create()
      let md5sum = 'fc7e0b72b8e64eb05e05aef652d6bbed950f85df'
      let doc /*: Object */ = {
        _id: path.normalize('backup/cat3.jpg'),
        path: path.normalize('backup/cat3.jpg'),
        docType: 'file',
        md5sum,
        updated_at: timestamp.current(),
        size: 36901,
        sides: {
          local: 1
        }
      }
      let same = {
        _id: path.normalize('ORIGINAL/CAT3.JPG'),
        path: path.normalize('ORIGINAL/CAT3.JPG'),
        docType: 'file',
        md5sum,
        updated_at: timestamp.current(),
        size: 36901,
        remote: {
          _id: '05161241-ca73',
          _rev: '1-abcdef'
        },
        sides: {
          local: 1,
          remote: 1
        }
      }
      await this.pouch.db.put(doc)
      await this.pouch.db.put(same)

      const created = await this.remote.addFileAsync(doc)

      should.exist(doc.remote._id)
      should.exist(doc.remote._rev)
      const file = await cozy.files.statById(created.remote._id)
      should(file.attributes).have.properties({
        dir_id: backupDir._id,
        name: 'cat3.jpg',
        type: 'file',
        updated_at: timestamp.stringify(doc.updated_at),
        size: '36901'
      })
    })

    it('creates the parent folder when missing', async function () {
      const metadata /*: Metadata */ = metadataBuilders.file().path(path.join('foo', 'bar', 'qux')).build()
      await this.remote.addFileAsync(metadata)
      await should(cozy.files.statByPath('/foo/bar')).be.fulfilled()
    })

    it('does not throw if the file does not exists locally anymore', async function () {
      const metadata /*: Metadata */ = metadataBuilders.file().path('foo').build()
      this.remote.other = {
        createReadStreamAsync (localDoc) {
          return fs.readFileAsync('/path/do/not/exists')
        }
      }
      await this.remote.addFileAsync(metadata)
      should.exist(metadata.remote._id)
      should.exist(metadata.remote._rev)
      should.exist(metadata._deleted)
    })
  })

  describe('addFolderAsync', () => {
    it('adds a folder to couchdb', async function () {
      const dateString = '2017-02-14T15:03:27Z'
      let doc /*: Object */ = {
        path: path.normalize('couchdb-folder/folder-1'),
        docType: 'folder',
        updated_at: dateString
      }
      const created /*: Metadata */ = await this.remote.addFolderAsync(doc)
      should.exist(doc.remote._id)
      should.exist(doc.remote._rev)

      const folder = await cozy.files.statById(created.remote._id)
      should(folder.attributes).have.properties({
        path: '/couchdb-folder/folder-1',
        name: 'folder-1',
        type: 'directory',
        updated_at: dateString
      })
    })

    it('does nothing when the folder already exists', async function () {
      const parentDir /*: RemoteDoc */ = await builders.remote.dir().create()
      const remoteDir /*: RemoteDoc */ = await builders.remote.dir().inDir(parentDir).create()
      const metadata /*: Metadata */ = {...conversion.createMetadata(remoteDir), remote: undefined}
      ensureValidPath(metadata)

      const result /*: Metadata */ = await this.remote.addFolderAsync(metadata)

      const folder /*: JsonApiDoc */ = await cozy.files.statById(result.remote._id)
      const {path, name, type, updated_at} = remoteDir
      should(folder.attributes).have.properties({path, name, type, updated_at})
      should(metadata.remote).have.properties({
        _id: remoteDir._id,
        _rev: remoteDir._rev
      })
    })

    it('creates the parent folder when missing', async function () {
      const metadata /*: Metadata */ = metadataBuilders.dir().path(path.join('foo', 'bar', 'qux')).build()
      await this.remote.addFolderAsync(metadata)
      await should(cozy.files.statByPath('/foo/bar')).be.fulfilled()
    })
  })

  if (process.platform === 'win32' && process.env.CI) {
    it.skip('overwrites the binary content (unstable on AppVeyor)', () => {})
  } else {
    describe('overwriteFileAsync', function () {
      it('overwrites the binary content', async function () {
        const created = await builders.remote.file().data('foo').timestamp(2015, 11, 16, 16, 12, 1).create()
        const old = conversion.createMetadata(created)
        const doc /*: Metadata */ = {
          ...old,
          _id: created._id,
          md5sum: 'N7UdGUp1E+RbVvZSTy1R8g==',
          updated_at: timestamp.stringify(timestamp.build(2015, 11, 16, 16, 12, 1)),
          sides: {
            local: 1
          }
        }
        await this.pouch.db.put(doc)
        this.remote.other = {
          createReadStreamAsync (localDoc) {
            localDoc.should.equal(doc)
            const stream = builders.stream().push('bar').build()
            return Promise.resolve(stream)
          }
        }

        await this.remote.overwriteFileAsync(doc, old)

        const file = await cozy.files.statById(doc.remote._id)
        should(file.attributes).have.properties({
          type: 'file',
          dir_id: created.dir_id,
          name: created.name,
          updated_at: '2015-11-16T16:12:01Z'
        })
        should(doc.remote._rev).equal(file._rev)
      })

      it('throws an error if the checksum is invalid', async function () {
        const created = await builders.remote.file().data('foo').create()
        const old = conversion.createMetadata(created)
        const doc = {
          ...old,
          md5sum: 'Invalid///////////////=='
        }
        this.remote.other = {
          createReadStreamAsync (localDoc) {
            const stream = builders.stream().push('bar').build()
            return Promise.resolve(stream)
          }
        }

        await should(this.remote.overwriteFileAsync(doc, old))
          .be.rejectedWith({status: 412})

        const file = await cozy.files.statById(doc.remote._id)
        should(file.attributes).have.properties({
          md5sum: old.md5sum
        })
      })

      it('does not throw if the file does not exists locally anymore', async function () {
        const metadata /*: Metadata */ = metadataBuilders.file().path('foo').build()
        this.remote.other = {
          createReadStreamAsync (localDoc) {
            return fs.readFileAsync('/path/do/not/exists')
          }
        }
        await this.remote.addFileAsync(metadata)
        should.exist(metadata.remote._id)
        should.exist(metadata.remote._rev)
        should.exist(metadata._deleted)
      })
    })
  }

  describe('updateFileMetadataAsync', () =>
    xit('updates the updated_at', async function () {
      const dir = await builders.remote.dir().named('dir').create()
      const created = await builders.remote.file()
        .named('file-7')
        .inDir(dir)
        .data('foo')
        .timestamp(2015, 11, 16, 16, 13, 1)
        .create()

      const doc /*: Object */ = {
        path: 'dir/file-7',
        docType: 'file',
        md5sum: 'N7UdGUp1E+RbVvZSTy1R8g==', // foo
        updated_at: '2015-11-16T16:13:01.001Z'
      }
      const old = {
        path: 'dir/file-7',
        docType: 'file',
        md5sum: 'N7UdGUp1E+RbVvZSTy1R8g==',
        remote: {
          _id: created._id,
          _rev: created._rev
        }
      }

      await this.remote.updateFileMetadataAsync(doc, old)

      const file = await cozy.files.statById(doc.remote._id)
      should(file.attributes).have.properties({
        type: 'file',
        dir_id: dir._id,
        name: 'file-7',
        updated_at: '2015-11-16T16:13:01Z'
      })
      should(doc.remote._rev).equal(file._rev)
    })
  )

  describe('updateFolder', function () {
    it('updates the metadata of a folder', async function () {
      const created /*: RemoteDoc */ = await builders.remote.dir()
        .named('old-name')
        .timestamp(2017, 11, 15, 8, 12, 9)
        .create()
      const old /*: Metadata */ = conversion.createMetadata(created)
      const newParentDir /*: RemoteDoc */ = await builders.remote.dir()
        .named('new-parent-dir')
        .inRootDir()
        .create()
      const doc /*: Metadata */ = {
        ...old,
        path: path.normalize('new-parent-dir/new-name'),
        updated_at: '2017-11-16T16:14:45Z'
      }

      const updated /*: Metadata */ = await this.remote.updateFolderAsync(doc, old)

      const folder /*: JsonApiDoc */ = await cozy.files.statById(updated.remote._id)
      should(folder.attributes).have.properties({
        path: '/new-parent-dir/new-name',
        type: 'directory',
        dir_id: newParentDir._id,
        updated_at: doc.updated_at
      })
      should(doc.remote).have.properties({
        _id: old.remote._id,
        _rev: folder._rev
      })
    })

    it('creates the dir if it does not exist', async function () {
      const parentDir /*: RemoteDoc */ = await builders.remote.dir()
        .named('parent-dir')
        .create()
      const deletedDir /*: RemoteDoc */ = await builders.remote.dir()
        .named('deleted-dir')
        .inDir(parentDir)
        .timestamp(2016, 1, 2, 3, 4, 5)
        .create()
      const oldMetadata /*: Metadata */ = conversion.createMetadata(deletedDir)
      const newMetadata /*: Metadata */ = {
        ...oldMetadata,
        name: 'new-dir-name',
        path: path.normalize('parent-dir/new-dir-name')
      }
      await cozy.files.destroyById(deletedDir._id)

      await this.remote.updateFolderAsync(newMetadata, oldMetadata)

      const created /*: JsonApiDoc */ = await cozy.files.statByPath('/parent-dir/new-dir-name')
      should(created.attributes).have.properties({
        type: 'directory',
        name: 'new-dir-name',
        dir_id: deletedDir.dir_id,
        updated_at: newMetadata.updated_at,
        tags: newMetadata.tags
      })
      should(newMetadata.remote).have.properties({
        _id: created._id,
        _rev: created._rev
      })
    })

    it('creates the dir if it has no remote info', async function () {
      const oldMetadata /*: Metadata */ = {
        ...conversion.createMetadata(builders.remote.dir().named('foo').build()),
        remote: undefined,
        updated_at: timestamp.stringify(timestamp.build(2015, 1, 1, 1, 1, 1))
      }
      const newMetadata /*: Metadata */ = {
        ...oldMetadata,
        updated_at: timestamp.stringify(timestamp.build(2015, 2, 2, 2, 2, 2))
      }

      const created /*: Metadata */ = await this.remote.updateFolderAsync(newMetadata, oldMetadata)

      const folder /*: JsonApiDoc */ = await cozy.files.statById(created.remote._id)
      should(folder.attributes).have.properties({
        type: 'directory',
        name: 'foo',
        dir_id: 'io.cozy.files.root-dir',
        updated_at: newMetadata.updated_at,
        tags: newMetadata.tags
      })
    })
  })

  describe('moveFileAsync', () => {
    let old, doc, newDir

    beforeEach(async () => {
      const remoteDoc /*: RemoteDoc */ = await builders
        .remote.file()
        .named('cat6.jpg')
        .data('meow')
        .create()
      old = (conversion.createMetadata(remoteDoc) /*: Metadata */)
      doc = ({
        ...old,
        path: path.normalize('moved-to/cat7.jpg'),
        name: 'cat7.jpg',
        remote: undefined
      } /*: Metadata */)
      newDir = (await builders.remote.dir()
        .named('moved-to')
        .inRootDir()
        .create() /*: RemoteDoc */)
    })

    it('moves the file', async function () {
      const moved /*: Metadata */ = await this.remote.moveFileAsync(doc, old)

      should(moved.remote._id).equal(old.remote._id)
      should(moved.remote._rev).not.equal(old.remote._rev)
      should(doc.remote).have.properties(moved.remote)
      const file = await cozy.files.statById(moved.remote._id)
      should(file).have.properties({
        _id: old.remote._id,
        _rev: moved.remote._rev
      })
      should(file.attributes).have.properties({
        dir_id: newDir._id,
        name: 'cat7.jpg',
        type: 'file',
        updated_at: doc.updated_at,
        size: '4'
      })
    })

    it('also updates its content when md5sum changed', async function () {
      doc.md5sum = 'j9tggB6dOaUoaqAd0fT08w==' // woof
      this.remote.other = {
        async createReadStreamAsync (doc) {
          return builders.stream().push('woof').build()
        }
      }

      const moved /*: Metadata */ = await this.remote.moveFileAsync(doc, old)

      should(moved.remote._id).equal(old.remote._id)
      should(moved.remote._rev).not.equal(old.remote._rev)
      should(doc.remote).have.properties(moved.remote)
      const file = await cozy.files.statById(moved.remote._id)
      should(file).have.properties({
        _id: old.remote._id,
        _rev: moved.remote._rev
      })
      should(file.attributes).have.properties({
        dir_id: newDir._id,
        name: 'cat7.jpg',
        type: 'file',
        updated_at: doc.updated_at,
        size: '4',
        md5sum: 'j9tggB6dOaUoaqAd0fT08w=='
      })
    })
  })

  xdescribe('moveFolder', function () {
    // it('moves the folder in couchdb', function (done) {
    //   return couchHelpers.createFolder(this.couch, 4, (_, created) => {
    //     let doc = {
    //       path: 'couchdb-folder/folder-5',
    //       docType: 'folder',
    //       updated_at: new Date(),
    //       remote: {
    //         _id: created.id,
    //         _rev: created.rev
    //       }
    //     }
    //     let old = {
    //       path: 'couchdb-folder/folder-4',
    //       docType: 'folder',
    //       remote: {
    //         _id: created.id,
    //         _rev: created.rev
    //       }
    //     }
    //     return this.remote.moveFolder(doc, old, (err, created) => {
    //       should.not.exist(err)
    //       return this.couch.get(created.id, function (err, folder) {
    //         should.not.exist(err)
    //         folder.should.have.properties({
    //           path: '/couchdb-folder',
    //           name: 'folder-5',
    //           docType: 'folder',
    //           updated_at: doc.updated_at.toISOString()
    //         })
    //         done()
    //       })
    //     })
    //   })
    // })

    it('adds a folder to couchdb if the folder does not exist', function (done) {
      let doc = {
        path: 'couchdb-folder/folder-7',
        docType: 'folder',
        updated_at: new Date()
      }
      let old = {
        path: 'couchdb-folder/folder-6',
        docType: 'folder'
      }
      return this.remote.moveFolder(doc, old, (err, created) => {
        should.not.exist(err)
        return this.couch.get(created.id, function (err, folder) {
          should.not.exist(err)
          folder.should.have.properties({
            path: '/couchdb-folder',
            name: 'folder-7',
            docType: 'folder',
            updated_at: doc.updated_at.toISOString()
          })
          done()
        })
      }
            )
    })
  })

  describe('trash', () => {
    it('moves the file or folder to the Cozy trash', async function () {
      const folder = await builders.remote.dir().create()
      const doc = conversion.createMetadata(folder)

      await this.remote.trashAsync(doc)

      const trashed = await cozy.files.statById(doc.remote._id)
      should(trashed).have.propertyByPath('attributes', 'dir_id').eql(TRASH_DIR_ID)
    })

    it('does nothing when file or folder does not exist anymore', async function () {
      const folder = await builders.remote.dir().build()
      const doc = conversion.createMetadata(folder)

      await this.remote.trashAsync(doc)

      await should(cozy.files.statById(doc.remote._id))
        .be.rejectedWith({status: 404})
    })
  })

  describe('deleteFolderAsync', () => {
    it('deletes permanently an empty folder', async function () {
      const folder = await builders.remote.dir().create()
      const doc = conversion.createMetadata(folder)

      await this.remote.deleteFolderAsync(doc)

      await should(cozy.files.statById(doc.remote._id))
        .be.rejectedWith({status: 404})
    })

    it('trashes a non-empty folder', async function () {
      const dir = await builders.remote.dir().create()
      const doc = conversion.createMetadata(dir)
      await builders.remote.dir().inDir(dir).create()

      await this.remote.deleteFolderAsync(doc)

      const trashed = await cozy.files.statById(doc.remote._id)
      should(trashed).have.propertyByPath('attributes', 'dir_id').eql(TRASH_DIR_ID)
    })

    it('resolves when folder does not exist anymore', async function () {
      const dir = await builders.remote.dir().build()
      const doc = conversion.createMetadata(dir)

      await this.remote.deleteFolderAsync(doc)

      await should(cozy.files.statById(doc.remote._id))
        .be.rejectedWith({status: 404})
    })

    it('resolves when folder is being deleted (race condition)', async function () {
      const dir = await builders.remote.dir().create()
      const doc = conversion.createMetadata(dir)
      sinon.stub(this.remote.remoteCozy, 'isEmpty').callsFake(async (id) => {
        await cozy.files.destroyById(id)
        return true
      })

      try {
        await should(this.remote.deleteFolderAsync(doc)).be.fulfilled()
      } finally {
        this.remote.remoteCozy.isEmpty.restore()
      }
    })

    it('does not swallow trashing errors', async function () {
      const dir = await builders.remote.dir().trashed().create()
      const doc = conversion.createMetadata(dir)
      await should(this.remote.deleteFolderAsync(doc)).be.rejected()
    })

    it('does not swallow emptiness check errors', async function () {
      const file = await builders.remote.file().create()
      const doc = conversion.createMetadata(file)
      await should(this.remote.deleteFolderAsync(doc)).be.rejected()
    })

    it('does not swallow destroy errors', async function () {
      const dir = await builders.remote.dir().create()
      const doc = conversion.createMetadata(dir)
      sinon.stub(this.remote.remoteCozy, 'destroyById').rejects('whatever')
      await should(this.remote.deleteFolderAsync(doc)).be.rejected()
    })
  })

  describe('assignNewRev', () => {
    it('updates the rev of a moved file', async function () {
      const remote = {src: {}, dst: {}}

      remote.src.dir = await builders.remote.dir().named('src-dir').inRootDir().create()
      remote.src.foo = await builders.remote.file().named('foo').inDir(remote.src.dir).create()
      remote.dst.dir = await this.remote.remoteCozy.updateAttributesById(remote.src.dir._id, {name: 'dst-dir'})
      remote.dst.foo = await this.remote.remoteCozy.find(remote.src.foo._id)

      const doc /*: Metadata */ = conversion.createMetadata(remote.src.foo)
      doc.path = 'dst-dir/foo' // File metadata was updated as part of the move
      await this.remote.assignNewRev(doc)
      should(doc).deepEqual(conversion.createMetadata(remote.dst.foo))
    })
  })

  describe('renameConflictingDocAsync', () =>
    it('renames the file/folder', async function () {
      const remoteDoc /*: RemoteDoc */ = await builders.remote.file().named('cat9').create()
      const src /*: Metadata */ = conversion.createMetadata(remoteDoc)
      ensureValidPath(src)
      const newPath = 'cat9-conflict-2015-12-01T01:02:03Z.jpg'
      await this.remote.renameConflictingDocAsync(src, newPath)
      const file /*: JsonApiDoc */ = await cozy.files.statById(remoteDoc._id)
      should(file.attributes).have.properties({
        ...pick(remoteDoc, ['dir_id', 'type', 'updated_at', 'size', 'md5sum']),
        name: newPath
      })
    })
  )
})
