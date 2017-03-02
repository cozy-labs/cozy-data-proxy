/* eslint-env mocha */

import async from 'async'
import fs from 'fs-extra'
import path from 'path'
import sinon from 'sinon'
import should from 'should'

import Watcher from '../../../src/local/watcher'

import configHelpers from '../../helpers/config'
import pouchHelpers from '../../helpers/pouch'

describe('LocalWatcher Tests', function () {
  this.timeout(10000)

  before('instanciate config', configHelpers.createConfig)
  before('instanciate pouch', pouchHelpers.createDatabase)
  beforeEach('instanciate local watcher', function () {
    this.prep = {}
    this.watcher = new Watcher(this.syncPath, this.prep, this.pouch)
  })
  afterEach('stop watcher and clean path', function (done) {
    if (this.watcher.watcher) {
      this.watcher.watcher.close()
    }
    return fs.emptyDir(this.syncPath, done)
  })
  after('clean pouch', pouchHelpers.cleanDatabase)
  after('clean config directory', configHelpers.cleanConfig)

  describe('start', function () {
    it('calls the callback when initial scan is done', function () {
      return this.watcher.start()
    })

    it('calls addFile/putFolder for files that are aleady here', function (done) {
      fs.ensureDirSync(path.join(this.syncPath, 'aa'))
      fs.ensureFileSync(path.join(this.syncPath, 'aa/ab'))
      this.prep.putFolder = sinon.spy()
      this.prep.addFile = sinon.spy()
      setTimeout(() => {
        this.prep.putFolder.called.should.be.true()
        this.prep.putFolder.args[0][0].should.equal('local')
        this.prep.putFolder.args[0][1].path.should.equal('aa')
        this.prep.addFile.called.should.be.true()
        this.prep.addFile.args[0][0].should.equal('local')
        this.prep.addFile.args[0][1].path.should.equal('aa/ab')
        done()
      }, 1100)
      this.watcher.start()
    })

    it('ignores .cozy-desktop', function (done) {
      fs.ensureDirSync(path.join(this.syncPath, '.cozy-desktop'))
      fs.ensureFileSync(path.join(this.syncPath, '.cozy-desktop/ac'))
      this.prep.putFolder = sinon.spy()
      this.prep.addFile = sinon.spy()
      this.prep.updateFile = sinon.spy()
      setTimeout(() => {
        this.prep.putFolder.called.should.be.false()
        this.prep.addFile.called.should.be.false()
        this.prep.updateFile.called.should.be.false()
        done()
      }, 1000)
      this.watcher.start()
    })
  })

  describe('createDoc', function () {
    it('creates a document for an existing file', function (done) {
      let src = path.join(__dirname, '../../fixtures/chat-mignon.jpg')
      let dst = path.join(this.syncPath, 'chat-mignon.jpg')
      fs.copySync(src, dst)
      return fs.stat(dst, (err, stats) => {
        should.not.exist(err)
        should.exist(stats)
        return this.watcher.createDoc('chat-mignon.jpg', stats, function (err, doc) {
          should.not.exist(err)
          doc.should.have.properties({
            path: 'chat-mignon.jpg',
            docType: 'file',
            checksum: '+HBGS7uN4XdB0blqLv5tFQ==',
            size: 29865,
            class: 'image',
            mime: 'image/jpeg'
          })
          doc.should.have.properties([
            'creationDate',
            'lastModification'
          ])
          should.not.exist(doc.executable)
          done()
        })
      })
    })

    it('sets the executable bit', function (done) {
      let filePath = path.join(this.syncPath, 'executable')
      fs.ensureFileSync(filePath)
      fs.chmodSync(filePath, '755')
      return fs.stat(filePath, (err, stats) => {
        should.not.exist(err)
        should.exist(stats)
        return this.watcher.createDoc('executable', stats, function (err, doc) {
          should.not.exist(err)
          doc.executable.should.be.true()
          done()
        })
      })
    })

    it('calls back with an error if the file is missing', function (done) {
      return this.watcher.createDoc('no/such/file', {}, function (err, doc) {
        should.exist(err)
        err.code.should.equal('ENOENT')
        done()
      })
    })
  })

  describe('getFileClass', () =>
    it('returns proper class for given file', function () {
      let [mimeType, fileClass] = this.watcher.getFileClass('image.png')
      mimeType.should.equal('image/png')
      fileClass.should.equal('image');
      [mimeType, fileClass] = this.watcher.getFileClass('doc.txt')
      mimeType.should.equal('text/plain')
      fileClass.should.equal('text')
    })
  )

  describe('checksum', function () {
    it('returns the checksum of an existing file', function (done) {
      let filePath = 'test/fixtures/chat-mignon.jpg'
      return this.watcher.checksum(filePath, function (err, sum) {
        should.not.exist(err)
        sum.should.equal('+HBGS7uN4XdB0blqLv5tFQ==')
        done()
      })
    })

    it('returns an error for a missing file', function (done) {
      let filePath = 'no/such/file'
      return this.watcher.checksum(filePath, function (err, sum) {
        should.exist(err)
        err.code.should.equal('ENOENT')
        done()
      })
    })
  })

  describe('hasPending', function () {
    it('returns true if a sub-folder is pending', function () {
      this.watcher.pending = Object.create(null)
      this.watcher.pending['bar'] = {}
      this.watcher.pending['foo/bar'] = {}
      this.watcher.pending['zoo'] = {}
      this.watcher.hasPending('foo').should.be.true()
      this.watcher.pending['foo/baz/bim'] = {}
      this.watcher.hasPending('foo/baz').should.be.true()
    })

    it('returns false else', function () {
      this.watcher.pending = Object.create(null)
      this.watcher.hasPending('foo').should.be.false()
      this.watcher.pending['foo'] = {}
      this.watcher.pending['bar/baz'] = {}
      this.watcher.hasPending('foo').should.be.false()
    })
  })

  describe('onAdd', () =>
    it('detects when a file is created', function (done) {
      this.watcher.start().then(() => {
        this.prep.addFile = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'aaa.jpg',
            docType: 'file',
            checksum: '+HBGS7uN4XdB0blqLv5tFQ==',
            size: 29865,
            class: 'image',
            mime: 'image/jpeg'
          })
          done()
        }
        let src = path.join(__dirname, '../../fixtures/chat-mignon.jpg')
        let dst = path.join(this.syncPath, 'aaa.jpg')
        return fs.copySync(src, dst)
      })
    })
  )

  describe('onAddDir', function () {
    it('detects when a folder is created', function (done) {
      this.watcher.start().then(() => {
        this.prep.putFolder = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'aba',
            docType: 'folder'
          })
          doc.should.have.properties([
            'creationDate',
            'lastModification'
          ])
          done()
        }
        return fs.mkdirSync(path.join(this.syncPath, 'aba'))
      })
    })

    it('detects when a sub-folder is created', function (done) {
      fs.mkdirSync(path.join(this.syncPath, 'abb'))
      this.prep.putFolder = () => {  // For aba folder
        this.prep.putFolder = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'abb/abc',
            docType: 'folder'
          })
          doc.should.have.properties([
            'creationDate',
            'lastModification'
          ])
          done()
        }
        return fs.mkdirSync(path.join(this.syncPath, 'abb/abc'))
      }
      this.watcher.start()
    })
  })

  describe('onUnlink', () =>
    it('detects when a file is deleted', function (done) {
      fs.ensureFileSync(path.join(this.syncPath, 'aca'))
      this.prep.addFile = () => {  // For aca file
        this.prep.deleteFile = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'aca'})
          done()
        }
        return fs.unlinkSync(path.join(this.syncPath, 'aca'))
      }
      this.watcher.start()
    })
  )

  describe('onUnlinkDir', () =>
    it('detects when a folder is deleted', function (done) {
      fs.mkdirSync(path.join(this.syncPath, 'ada'))
      this.prep.putFolder = () => {  // For ada folder
        this.prep.deleteFolder = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'ada'})
          done()
        }
        return fs.rmdirSync(path.join(this.syncPath, 'ada'))
      }
      this.watcher.start()
    })
  )

  describe('onChange', () =>
    it('detects when a file is changed', function (done) {
      let src = path.join(__dirname, '../../fixtures/chat-mignon.jpg')
      let dst = path.join(this.syncPath, 'aea.jpg')
      fs.copySync(src, dst)
      this.prep.addFile = () => {
        this.prep.updateFile = function (side, doc) {
          side.should.equal('local')
          doc.should.have.properties({
            path: 'aea.jpg',
            docType: 'file',
            checksum: 'tdmDwDisJe/rJn+2fV+rNA==',
            size: 36901,
            class: 'image',
            mime: 'image/jpeg'
          })
          done()
        }
        src = src.replace(/\.jpg$/, '-mod.jpg')
        dst = path.join(this.syncPath, 'aea.jpg')
        return fs.copySync(src, dst)
      }
      this.watcher.start()
    })
  )

  describe('when a file is moved', function () {
    // This integration test is unstable on travis + OSX (too often red).
    // It's disabled for the moment, but we should find a way to make it
    // more stable on travis, and enable it again.
    if (process.env.TRAVIS && (process.platform === 'darwin')) {
      it('is unstable on travis')
      return
    }

    before('reset pouchdb', function (done) {
      return this.pouch.resetDatabase(done)
    })

    it('deletes the source and adds the destination', function (done) {
      let src = path.join(__dirname, '../../fixtures/chat-mignon.jpg')
      let dst = path.join(this.syncPath, 'afa.jpg')
      fs.copySync(src, dst)
      this.prep.addFile = (side, doc) => {
        doc._id = doc.path
        return this.pouch.db.put(doc)
      }
      this.watcher.start().then(() => {
        return setTimeout(() => {
          this.prep.deleteFile = sinon.spy()
          this.prep.addFile = sinon.spy()
          this.prep.moveFile = (side, doc, was) => {
            this.prep.deleteFile.called.should.be.false()
            this.prep.addFile.called.should.be.false()
            side.should.equal('local')
            doc.should.have.properties({
              path: 'afb.jpg',
              docType: 'file',
              checksum: '+HBGS7uN4XdB0blqLv5tFQ==',
              size: 29865,
              class: 'image',
              mime: 'image/jpeg'
            })
            was.should.have.properties({
              path: 'afa.jpg',
              docType: 'file',
              checksum: '+HBGS7uN4XdB0blqLv5tFQ==',
              size: 29865
            })
            done()
          }
          return fs.renameSync(dst, path.join(this.syncPath, 'afb.jpg'))
        }, 2000)
      })
    })
  })

  describe('when a directory is moved', function () {
        // This integration test is unstable on travis + OSX (too often red).
        // It's disabled for the moment, but we should find a way to make it
        // more stable on travis, and enable it again.
    if (process.env.TRAVIS && (process.platform === 'darwin')) {
      it('is unstable on travis')
      return
    }

    before('reset pouchdb', function (done) {
      return this.pouch.resetDatabase(done)
    })

    it('deletes the source and adds the destination', function (done) {
      let src = path.join(this.syncPath, 'aga')
      let dst = path.join(this.syncPath, 'agb')
      fs.ensureDirSync(src)
      fs.writeFileSync(`${src}/agc`, 'agc')
      this.prep.addFile = this.prep.putFolder = (side, doc) => {
        doc._id = doc.path
        return this.pouch.db.put(doc)
      }
      this.watcher.start().then(() => {
        return setTimeout(() => {
          this.prep.updateFile = sinon.spy()
          this.prep.addFile = sinon.spy()
          this.prep.deleteFile = sinon.spy()
          this.prep.moveFile = sinon.spy()
          this.prep.deleteFolder = sinon.spy()
          this.prep.putFolder = (side, doc) => {
            side.should.equal('local')
            doc.should.have.properties({
              path: 'agb',
              docType: 'folder'
            })
            return setTimeout(() => {
              this.prep.addFile.called.should.be.false()
              this.prep.deleteFile.called.should.be.false()
              this.prep.moveFile.called.should.be.true()
              src = this.prep.moveFile.args[0][2]
              src.should.have.properties({path: 'aga/agc'})
              dst = this.prep.moveFile.args[0][1]
              dst.should.have.properties({path: 'agb/agc'})
              this.prep.deleteFolder.called.should.be.true()
              let args = this.prep.deleteFolder.args[0][1]
              args.should.have.properties({path: 'aga'})
              done()
            }, 4000)
          }
          return fs.renameSync(src, dst)
        }, 1800)
      })
    })
  })

  describe('onReady', function () {
    before('reset pouchdb', function (done) {
      return this.pouch.resetDatabase(done)
    })

    it('detects deleted files and folders', function (done) {
      let dd = this.prep.deleteDoc = sinon.stub().yields()
      let folder1 = {
        _id: 'folder1',
        path: 'folder1',
        docType: 'folder'
      }
      let folder2 = {
        _id: 'folder2',
        path: 'folder2',
        docType: 'folder'
      }
      let file1 = {
        _id: 'file1',
        path: 'file1',
        docType: 'folder'
      }
      let file2 = {
        _id: 'file2',
        path: 'file2',
        docType: 'folder'
      }
      return async.each([folder1, folder2, file1, file2], (doc, next) => {
        return this.pouch.db.put(doc, next)
      }, () => {
        this.watcher.paths = ['folder1', 'file1']
        let cb = this.watcher.onReady(function () {
          dd.calledTwice.should.be.true()
          dd.calledWithMatch('local', folder1).should.be.false()
          dd.calledWithMatch('local', folder2).should.be.true()
          dd.calledWithMatch('local', file1).should.be.false()
          dd.calledWithMatch('local', file2).should.be.true()
          done()
        })
        return cb()
      })
    })
  })
})
