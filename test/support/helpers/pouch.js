const { assignId } = require('../../../core/metadata')
const { Pouch } = require('../../../core/pouch')

module.exports = {
  createDatabase(done) {
    this.pouch = new Pouch(this.config)
    return this.pouch.addAllViews(done)
  },

  cleanDatabase(done) {
    this.pouch.db.destroy(() => {
      this.pouch = null
      done()
    })
  },

  createParentFolder(pouch) {
    let doc = {
      path: 'my-folder',
      docType: 'folder',
      updated_at: new Date().toISOString(),
      tags: [],
      remote: {
        _id: `XXX`,
        _rev: '1-abc'
      },
      sides: {
        local: 1,
        remote: 1
      }
    }
    assignId(doc)
    return pouch.db.put(doc).then(({ rev }) => ({ ...doc, _rev: rev }))
  },

  createFolder(pouch, folderPath) {
    let doc = {
      path: folderPath,
      docType: 'folder',
      updated_at: new Date().toISOString(),
      tags: [],
      remote: {
        _id: `123456789-${folderPath}`
      },
      sides: {
        local: 1,
        remote: 1
      }
    }
    assignId(doc)
    return pouch.db.put(doc).then(({ rev }) => ({ ...doc, _rev: rev }))
  },

  createFile(pouch, filePath) {
    let doc = {
      path: filePath,
      docType: 'file',
      md5sum: `111111111111111111111111111111111111111${filePath}`,
      updated_at: new Date().toISOString(),
      tags: [],
      remote: {
        _id: `1234567890-${filePath}`
      },
      sides: {
        local: 1,
        remote: 1
      }
    }
    assignId(doc)
    return pouch.db.put(doc).then(({ rev }) => ({ ...doc, _rev: rev }))
  }
}
