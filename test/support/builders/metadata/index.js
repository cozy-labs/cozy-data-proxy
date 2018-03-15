/* @flow */

const Pouch = require('../../../../core/pouch')

const DirMetadataBuilder = require('./dir')
const FileMetadataBuilder = require('./file')

module.exports = class MetadataBuilders {
  pouch: ?Pouch

  constructor (pouch: ?Pouch) {
    this.pouch = pouch
  }

  dir (): DirMetadataBuilder {
    return new DirMetadataBuilder(this.pouch)
  }

  file (): FileMetadataBuilder {
    return new FileMetadataBuilder(this.pouch)
  }
}
