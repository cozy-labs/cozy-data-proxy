/* @flow */

const fs = require('fs-extra')
const { setup, suite, test } = require('mocha')
const path = require('path')
const should = require('should')

should.Assertion.add('hex', function (expectedPretty) {
  const expected = expectedPretty.trim().split(/\s+/)
  const actual = Buffer.from(this.obj).toString('hex').match(/.{1,2}/g)
  this.params = {operator: `to be represented as: ${expected.join(' ')}`}
  should(actual).deepEqual(expected)
})

suite('Case and encoding basics', () => {
  // Test helpers
  const tmpdir = path.resolve(`tmp/test/unit/case_and_encoding`)
  const abspath = (relpath) => path.join(tmpdir, relpath)
  const createFile = (filename) => fs.ensureFile(abspath(filename))
  const rename = (src, dst) => fs.rename(abspath(src), abspath(dst))
  const listFiles = () => fs.readdir(tmpdir)

  setup(() => fs.emptyDir(tmpdir))

  test('Node.js strings', () => {
    should('e').have.hex('            65       ')
    should('é').have.hex('               c3 a9 ')
    should('\u00e9').have.hex('          c3 a9 ')
    should('é').have.hex('            65 cc 81 ')
    should('\u0065\u0301').have.hex(' 65 cc 81 ')
  })

  test('create file NFC', async () => {
    await createFile('\u00e9')
    switch (process.platform) {
      case 'linux':
      case 'win32':
        should(await listFiles()).deepEqual(['\u00e9'])
        break
      case 'darwin':
        should(await listFiles()).deepEqual(['\u0065\u0301'])
        break
    }
  })

  test('create file NFD', async () => {
    await createFile('\u0065\u0301')
    switch (process.platform) {
      case 'linux':
      case 'darwin':
      case 'win32':
        should(await listFiles()).deepEqual(['\u0065\u0301'])
        break
    }
  })

  test('upcase file', async () => {
    await createFile('foo')
    should(await listFiles()).deepEqual(['foo'])
    await rename('foo', 'FOO')
    switch (process.platform) {
      case 'linux':
      case 'darwin':
      case 'win32':
        should(await listFiles()).deepEqual(['FOO'])
        break
    }
  })

  test('path.join', async () => {
    switch (process.platform) {
      case 'linux':
      case 'darwin':
        should(path.join('a', '\u00e9')).equal('a/\u00e9')
        should(path.join('a', '\u0065\u0301')).equal('a/\u0065\u0301')
        break
      case 'win32':
        should(path.join('a', '\u00e9')).equal('a\\\u00e9')
        should(path.join('a', '\u0065\u0301')).equal('a\\\u0065\u0301')
        break
    }
  })

  test('rename identical', async () => {
    await createFile('foo')
    await should(rename('foo', 'foo')).not.be.rejected()
  })

  test('rename file NFD -> NFC', async () => {
    await createFile('\u0065\u0301')
    await rename('\u0065\u0301', '\u00e9')
    switch (process.platform) {
      case 'linux':
      case 'win32':
        should(await listFiles()).deepEqual(['\u00e9'])
        break
      case 'darwin':
        should(await listFiles()).deepEqual(['\u0065\u0301'])
        break
    }
  })

  test('rename file NFC -> NFD', async () => {
    await createFile('\u00e9')
    await rename('\u00e9', '\u0065\u0301')
    switch (process.platform) {
      case 'linux':
      case 'win32':
      case 'darwin':
        should(await listFiles()).deepEqual(['\u0065\u0301'])
        break
    }
  })
})
