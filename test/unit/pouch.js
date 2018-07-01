/* eslint-env mocha */

const async = require('async')
const Promise = require('bluebird')
const jsv = require('jsverify')
const path = require('path')
const should = require('should')
const sinon = require('sinon')
const _ = require('lodash')
const { uniq } = _

const metadata = require('../../core/metadata')

const configHelpers = require('../support/helpers/config')
const pouchHelpers = require('../support/helpers/pouch')

describe('Pouch', function () {
  before('instanciate config', configHelpers.createConfig)
  before('instanciate pouch', pouchHelpers.createDatabase)
  after('clean pouch', pouchHelpers.cleanDatabase)
  after('clean config directory', configHelpers.cleanConfig)

  before('create folders and files', async function () {
    await pouchHelpers.createParentFolder(this.pouch)
    for (let i of [1, 2, 3]) {
      await pouchHelpers.createFolder(this.pouch, i)
      await pouchHelpers.createFile(this.pouch, i)
    }
  })

  describe('lock', () => {
    it('ensures nobody else accesses Pouch until released', async function () {
      const promiseLock1 = this.pouch.lock('lock1')
      await should(promiseLock1).be.fulfilled()
      const releaseLock1 = promiseLock1.value()
      const promiseLock2 = this.pouch.lock('lock2')
      const promiseLock3 = this.pouch.lock('lock3')
      should(promiseLock2.isPending()).be.true()
      should(promiseLock3.isPending()).be.true()
      releaseLock1()
      should(promiseLock3.isPending()).be.true()
      await should(promiseLock2).be.fulfilled()
      const releaseLock2 = promiseLock2.value()
      should(promiseLock3.isPending()).be.true()
      releaseLock2()
      await should(promiseLock3).be.fulfilled()
      const releaseLock3 = promiseLock2.value()
      releaseLock3()
    })
  })

  describe('ODM', function () {
    describe('getAll', () =>
      it('returns all the documents matching the query', async function () {
        let params = {
          key: metadata.id('my-folder'),
          include_docs: true
        }
        const docs = await this.pouch.getAllAsync('byPath', params)
        docs.length.should.equal(6)
        for (let i = 1; i <= 3; i++) {
          docs[i - 1].should.have.properties({
            _id: metadata.id(path.join('my-folder', `file-${i}`)),
            docType: 'file',
            tags: []
          })
          docs[i + 2].should.have.properties({
            _id: metadata.id(path.join('my-folder', `folder-${i}`)),
            docType: 'folder',
            tags: []
          })
        }
      })
    )

    describe('byChecksum', () =>
      it('gets all the files with this checksum', async function () {
        let _id = metadata.id(path.join('my-folder', 'file-1'))
        let checksum = '1111111111111111111111111111111111111111'
        const docs = await this.pouch.byChecksumAsync(checksum)
        docs.length.should.be.equal(1)
        docs[0]._id.should.equal(_id)
        docs[0].md5sum.should.equal(checksum)
      })
    )

    describe('byPath', function () {
      it('gets all the files and folders in this path', async function () {
        const docs = await this.pouch.byPathAsync(metadata.id('my-folder'))
        docs.length.should.be.equal(6)
        for (let i = 1; i <= 3; i++) {
          docs[i - 1].should.have.properties({
            _id: metadata.id(path.join('my-folder', `file-${i}`)),
            docType: 'file',
            tags: []
          })
          docs[i + 2].should.have.properties({
            _id: metadata.id(path.join('my-folder', `folder-${i}`)),
            docType: 'folder',
            tags: []
          })
        }
      })

      it('gets only files and folders in the first level', async function () {
        const docs = await this.pouch.byPathAsync('')
        docs.length.should.be.equal(1)
        docs[0].should.have.properties({
          _id: metadata.id('my-folder'),
          docType: 'folder',
          tags: []
        })
      })

      it('ignores design documents', async function () {
        const docs = await this.pouch.byPathAsync('_design')
        docs.length.should.be.equal(0)
      })
    })

    describe('byRecurivePath', function () {
      it('gets the files and folders in this path recursively', async function () {
        const docs = await this.pouch.byRecursivePathAsync(metadata.id('my-folder'))
        docs.length.should.be.equal(6)
        for (let i = 1; i <= 3; i++) {
          docs[i - 1].should.have.properties({
            _id: metadata.id(path.join('my-folder', `file-${i}`)),
            docType: 'file',
            tags: []
          })
          docs[i + 2].should.have.properties({
            _id: metadata.id(path.join('my-folder', `folder-${i}`)),
            docType: 'folder',
            tags: []
          })
        }
      })

      it('gets the files and folders from root', async function () {
        const docs = await this.pouch.byRecursivePathAsync('')
        docs.length.should.be.equal(7)
        docs[0].should.have.properties({
          _id: metadata.id('my-folder'),
          docType: 'folder',
          tags: []
        })
        for (let i = 1; i <= 3; i++) {
          docs[i].should.have.properties({
            _id: metadata.id(path.join('my-folder', `file-${i}`)),
            docType: 'file',
            tags: []
          })
          docs[i + 3].should.have.properties({
            _id: metadata.id(path.join('my-folder', `folder-${i}`)),
            docType: 'folder',
            tags: []
          })
        }
      })
    })

    describe('byRemoteId', function () {
      it('gets all the file with this remote id', async function () {
        let id = '12345678901'
        const doc = await this.pouch.byRemoteIdAsync(id)
        doc.remote._id.should.equal(id)
        should.exist(doc._id)
        should.exist(doc.docType)
      })

      it('returns a 404 error if no file matches', async function () {
        let id = 'abcdef'
        await should(this.pouch.byRemoteIdAsync(id))
          .be.rejectedWith({status: 404})
      })
    })

    describe('byRemoteIdMaybe', function () {
      it('does the same as byRemoteId() when document exists', async function () {
        let id = '12345678901'
        const doc = await this.pouch.byRemoteIdMaybeAsync(id)
        doc.remote._id.should.equal(id)
        should.exist(doc._id)
        should.exist(doc.docType)
      })

      it('returns null when document does not exist', async function () {
        let id = 'abcdef'
        const doc = await this.pouch.byRemoteIdMaybeAsync(id)
        should.equal(null, doc)
      })

      it('returns any non-404 error', async function () {
        const otherError = new Error('not a 404')
        sinon.stub(this.pouch, 'byRemoteId').yields(otherError)

        await should(this.pouch.byRemoteIdMaybeAsync('12345678901'))
          .be.rejectedWith(otherError)
      })
    })
  })

  describe('Views', function () {
    describe('createDesignDoc', function () {
      let query = `\
function (doc) {
    if (doc.docType === 'file') {
        emit(doc._id);
    }
}\
`

      it('creates a new design doc', async function () {
        await this.pouch.createDesignDocAsync('file', query)
        const docs = await this.pouch.getAllAsync('file')
        docs.length.should.equal(3)
        for (let i = 1; i <= 3; i++) {
          docs[i - 1].docType.should.equal('file')
        }
      })

      it('does not update the same design doc', async function () {
        await this.pouch.createDesignDocAsync('file', query)
        const was = await this.pouch.db.get('_design/file')
        await this.pouch.createDesignDocAsync('file', query)
        const designDoc = await this.pouch.db.get('_design/file')
        designDoc._id.should.equal(was._id)
        designDoc._rev.should.equal(was._rev)
      })

      it('updates the design doc if the query change', async function () {
        await this.pouch.createDesignDocAsync('file', query)
        const was = await this.pouch.db.get('_design/file')
        let newQuery = query.replace('file', 'File')
        await this.pouch.createDesignDocAsync('file', newQuery)
        const designDoc = await this.pouch.db.get('_design/file')
        designDoc._id.should.equal(was._id)
        designDoc._rev.should.not.equal(was._rev)
        designDoc.views.file.map.should.equal(newQuery)
      })
    })

    describe('addByPathView', () =>
      it('creates the path view', async function () {
        await this.pouch.addByPathViewAsync()
        const doc = await this.pouch.db.get('_design/byPath')
        should.exist(doc)
      })
    )

    describe('addByChecksumView', () =>
      it('creates the checksum view', async function () {
        await this.pouch.addByChecksumViewAsync()
        const doc = await this.pouch.db.get('_design/byChecksum')
        should.exist(doc)
      })
    )

    describe('addByRemoteIdView', () =>
      it('creates the remote id view', async function () {
        await this.pouch.addByRemoteIdViewAsync()
        const doc = await this.pouch.db.get('_design/byRemoteId')
        should.exist(doc)
      })
    )

    describe('removeDesignDoc', () =>
      it('removes given view', async function () {
        let query = `\
function (doc) {
if (doc.docType === 'folder') {
  emit(doc._id);
}
}\
`
        await this.pouch.createDesignDocAsync('folder', query)
        const docs = await this.pouch.getAllAsync('folder')
        docs.length.should.be.above(1)
        await this.pouch.removeDesignDocAsync('folder')
        await should(this.pouch.getAllAsync('folder')).be.rejectedWith({status: 404})
      })
    )
  })

  describe('Helpers', function () {
    describe('getPreviousRev', () =>
      it('retrieves previous document informations', async function () {
        let id = metadata.id(path.join('my-folder', 'folder-1'))
        let doc = await this.pouch.db.get(id)
        doc.tags = ['yipee']
        const updated = await this.pouch.db.put(doc)
        await this.pouch.db.remove(id, updated.rev)
        doc = await this.pouch.getPreviousRevAsync(id, 1)
        doc._id.should.equal(id)
        doc.tags.should.not.equal(['yipee'])
        doc = await this.pouch.getPreviousRevAsync(id, 2)
        doc._id.should.equal(id)
        doc.tags.join(',').should.equal('yipee')
      })
    )
  })

  describe('Sequence numbers', function () {
    describe('getLocalSeq', () =>
      it('gets 0 when the local seq number is not initialized', async function () {
        await should(this.pouch.getLocalSeqAsync()).be.fulfilledWith(0)
      })
    )

    describe('setLocalSeq', () =>
      it('saves the local sequence number', async function () {
        await this.pouch.setLocalSeqAsync(21)
        await should(this.pouch.getLocalSeqAsync()).be.fulfilledWith(21)
        await this.pouch.setLocalSeqAsync(22)
        await should(this.pouch.getLocalSeqAsync()).be.fulfilledWith(22)
      })
    )

    describe('getRemoteSeq', () =>
      it('gets 0 when the remote seq number is not initialized', async function () {
        await should(this.pouch.getRemoteSeqAsync()).be.fulfilledWith(0)
      })
    )

    describe('setRemoteSeq', function () {
      it('saves the remote sequence number', async function () {
        await this.pouch.setRemoteSeqAsync(31)
        await should(this.pouch.getRemoteSeqAsync()).be.fulfilledWith(31)
        await this.pouch.setRemoteSeqAsync(32)
        await should(this.pouch.getRemoteSeqAsync()).be.fulfilledWith(32)
      })

      it('can be called multiple times in parallel', function (done) {
        return async.each(_.range(1, 101), this.pouch.setRemoteSeq, function (err) {
          should.not.exist(err)
          done()
        })
      })
    })
  })

  // Disable this test on travis because it can be really slow...
  if (process.env.CI) { return }
  describe('byRecursivePath (bis)', function () {
    // TODO counter  rngState: 0020bacd4697fe1358;
    //               Counterexample: [".", "Æ\u0004]"]
    //               rngState: 0d2c085d3e964fb71a;
    //               Counterexample: [".", "a\u0012%"];
    //               rngState: 8df0312a56cde9b748;
    //               Counterexample: ["."];

    // jsverify only works with Promise for async stuff
    if (typeof Promise !== 'function') { return }

    it('gets the nested files and folders', function (done) {
      let base = 'byRecursivePath'
      let property = jsv.forall('nearray nestring', paths => {
        paths = uniq(paths.concat([base]))
        return new Promise((resolve, reject) => {
          return this.pouch.resetDatabase(function (err) {
            if (err) {
              return reject(err)
            } else {
              return resolve()
            }
          })
        }).then(() => {
          return Promise.all(paths.map(p => {
            let doc = {
              _id: metadata.id(path.join(base, p)),
              docType: 'folder'
            }
            return this.pouch.db.put(doc)
          }))
        }).then(() => {
          return new Promise((resolve, reject) => {
            return this.pouch.byRecursivePath(metadata.id(base), function (err, docs) {
              if (err) {
                return reject(err)
              } else {
                return resolve(docs.length === paths.length)
              }
            })
          })
        })
      })
      jsv.assert(property, {tests: 10}).then(function (res) {
        if (res === true) { done() } else { return done(res) }
      })
    })
  })
})
