/* @flow */
/* eslint-env mocha */

/*::
import type { Metadata } from '../../core/metadata'
import type { RemoteDoc } from '../../core/remote/document'
*/

const should = require('should')
const path = require('path')

const conversion = require('../../core/conversion')
const { FILES_DOCTYPE } = require('../../core/remote/constants')
const timestamp = require('../../core/timestamp')

describe('conversion', function () {
  describe('createMetadata', () => {
    it('builds the metadata for a remote file', () => {
      let remoteDoc /*: RemoteDoc */ = {
        _id: '12',
        _rev: '34',
        _type: FILES_DOCTYPE,
        class: 'document',
        dir_id: '56',
        executable: false,
        md5sum: 'N7UdGUp1E+RbVvZSTy1R8g==',
        mime: 'test/html',
        name: 'bar',
        path: '/foo/bar',
        size: '78',
        tags: ['foo'],
        type: 'file',
        updated_at: timestamp.stringify(timestamp.build(2017, 9, 8, 7, 6, 5))
      }
      let doc /*: Metadata */ = conversion.createMetadata(remoteDoc)

      should(doc).deepEqual({
        md5sum: 'N7UdGUp1E+RbVvZSTy1R8g==',
        class: 'document',
        docType: 'file',
        updated_at: '2017-09-08T07:06:05Z',
        mime: 'test/html',
        path: 'foo/bar',
        remote: {
          _id: '12',
          _rev: '34'
        },
        size: 78,
        tags: ['foo']
      })

      remoteDoc.executable = true
      doc = conversion.createMetadata(remoteDoc)
      should(doc.executable).equal(true)
    })

    it('builds the metadata for a remote dir', () => {
      const remoteDoc /*: RemoteDoc */ = {
        _id: '12',
        _rev: '34',
        _type: FILES_DOCTYPE,
        dir_id: '56',
        name: 'bar',
        path: '/foo/bar',
        tags: ['foo'],
        type: 'directory',
        updated_at: timestamp.stringify(timestamp.build(2017, 9, 8, 7, 6, 5))
      }

      const doc = conversion.createMetadata(remoteDoc)

      should(doc).deepEqual({
        docType: 'folder',
        updated_at: '2017-09-08T07:06:05Z',
        path: 'foo/bar',
        remote: {
          _id: '12',
          _rev: '34'
        },
        tags: ['foo']
      })
    })
  })

  describe('extractDirAndName', () => {
    it('returns the remote path and name', function () {
      let [dir, name] = conversion.extractDirAndName('foo')
      should(dir).equal('/')
      should(name).equal('foo');
      [dir, name] = conversion.extractDirAndName(path.normalize('foo/bar'))
      should(dir).equal('/foo')
      should(name).equal('bar');
      [dir, name] = conversion.extractDirAndName(path.normalize('foo/bar/baz'))
      should(dir).equal('/foo/bar')
      should(name).equal('baz')
    })
  })
})
