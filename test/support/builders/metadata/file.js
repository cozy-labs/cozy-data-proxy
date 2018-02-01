/* @flow */

import BaseMetadataBuilder from './base'
import { assignId } from '../../../../core/metadata'

import type { Metadata } from '../../../../core/metadata'

import pouchdbBuilders from '../pouchdb'

export default class FileMetadataBuilder extends BaseMetadataBuilder {
  build (): Metadata {
    const doc = {
      ...this.opts,
      _id: '',
      // _rev: pouchdbBuilders.rev(),
      docType: 'file',
      remote: {
        _id: pouchdbBuilders.id(),
        _rev: pouchdbBuilders.rev()
      },
      tags: [],
      updated_at: new Date()
    }
    assignId(doc)
    return doc
  }
}
