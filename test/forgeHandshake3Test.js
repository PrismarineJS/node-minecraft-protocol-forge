'use strict'
/* eslint-env mocha */

const assert = require('assert')
const { EventEmitter } = require('events')

const forgeHandshake3 = require('../src/client/forgeHandshake3')

function makeClient () {
  const client = new EventEmitter()
  client.registerChannel = () => {}
  client.writes = []
  client.write = (name, data) => client.writes.push({ name, data })
  client.on('login_plugin_request', function onLoginPluginRequest () {})
  return client
}

function string (value) {
  const bytes = Buffer.from(value)
  assert.ok(bytes.length < 128, 'test helper supports one-byte VarInts')
  return Buffer.concat([Buffer.from([bytes.length]), bytes])
}

function loginWrapper (channel, payload) {
  assert.ok(payload.length < 128, 'test helper supports one-byte VarInts')
  return Buffer.concat([string(channel), Buffer.from([payload.length]), payload])
}

describe('FML3 handshake', () => {
  for (const trailingList of [Buffer.alloc(0), Buffer.from([0]), Buffer.concat([Buffer.from([1]), string('example:registry')])]) {
    it(`accepts ModList with ${trailingList.length === 0 ? 'omitted' : 'present'} data-pack registry list (${trailingList.length} bytes)`, () => {
      const client = makeClient()
      forgeHandshake3(client)
      client.emit('login_plugin_request', {
        messageId: 1,
        channel: 'fml:loginwrapper',
        data: loginWrapper('fml:handshake', Buffer.concat([Buffer.from([1, 0, 0, 0]), trailingList]))
      })
      assert.deepStrictEqual(client.writes, [{
        name: 'login_plugin_response',
        data: { messageId: 1, data: loginWrapper('fml:handshake', Buffer.from([2, 0, 0, 0])) }
      }])
    })
  }

  it('does not answer the no-response ModData query', () => {
    const client = makeClient()
    forgeHandshake3(client, { forgeMods: [] })

    client.emit('login_plugin_request', {
      messageId: 0,
      channel: 'fml:loginwrapper',
      data: Buffer.from('0d666d6c3a68616e647368616b65310502096d696e656372616674094d696e65637261667406312e32302e3105666f72676505466f7267650734372e342e3130', 'hex')
    })

    assert.deepStrictEqual(client.writes, [])
  })

  it('acknowledges a server registry without a snapshot', () => {
    const client = makeClient()
    forgeHandshake3(client, { forgeMods: [] })

    client.emit('login_plugin_request', {
      messageId: 2,
      channel: 'fml:loginwrapper',
      data: loginWrapper('fml:handshake', Buffer.concat([
        Buffer.from([3]),
        string('minecraft:test'),
        Buffer.from([0])
      ]))
    })

    assert.equal(client.writes.length, 1)
    assert.equal(client.writes[0].name, 'login_plugin_response')
    assert.equal(client.writes[0].data.messageId, 2)
    assert.ok(Buffer.isBuffer(client.writes[0].data.data))
    assert.equal(client.writes[0].data.data.toString('hex'), '0d666d6c3a68616e647368616b650163')
  })

  for (const legacyDummies of [false, true]) {
    it(`acknowledges a registry snapshot ${legacyDummies ? 'with' : 'without'} legacy dummied entries`, () => {
      const client = makeClient()
      forgeHandshake3(client, { forgeMods: [] })
      const snapshotWithoutLegacyDummies = Buffer.concat([
        Buffer.from([1, 1]), // present snapshot, one ID entry
        string('minecraft:test'), Buffer.from([0]),
        Buffer.from([0]), // aliases
        Buffer.from([0]), // overrides
        Buffer.from([0]), // blocked ids
        legacyDummies ? Buffer.concat([Buffer.from([1]), string('minecraft:removed')]) : Buffer.alloc(0)
      ])

      client.emit('login_plugin_request', {
        messageId: 2,
        channel: 'fml:loginwrapper',
        data: loginWrapper('fml:handshake', Buffer.concat([
          Buffer.from([3]),
          string('minecraft:test_registry'),
          snapshotWithoutLegacyDummies
        ]))
      })

      assert.equal(client.writes.length, 1)
      assert.equal(client.writes[0].data.messageId, 2)
      assert.equal(client.writes[0].data.data.toString('hex'), '0d666d6c3a68616e647368616b650163')
    })
  }

  it('does not claim support for an unhandled mod login channel', () => {
    const client = makeClient()
    forgeHandshake3(client, { forgeMods: [] })
    let observed
    client.once('forgeLoginPluginRequest', request => { observed = request })

    client.emit('login_plugin_request', {
      messageId: 23,
      channel: 'fml:loginwrapper',
      data: loginWrapper('tacz:handshake', Buffer.from([2, 0]))
    })

    assert.equal(observed.channel, 'tacz:handshake')
    assert.deepStrictEqual(client.writes, [{ name: 'login_plugin_response', data: { messageId: 23 } }])
  })

  it('wraps an explicit mod login handler response on the originating channel', () => {
    const client = makeClient()
    forgeHandshake3(client, {
      forgeMods: ['tacz'],
      loginHandlers: {
        'tacz:handshake': data => {
          assert.equal(data[0], 2)
          return Buffer.from([1])
        }
      }
    })

    client.emit('login_plugin_request', {
      messageId: 23,
      channel: 'fml:loginwrapper',
      data: loginWrapper('tacz:handshake', Buffer.from([2, 0]))
    })

    assert.equal(client.writes.length, 1)
    assert.deepStrictEqual(client.writes[0], {
      name: 'login_plugin_response',
      data: {
        messageId: 23,
        data: loginWrapper('tacz:handshake', Buffer.from([1]))
      }
    })
  })

  it('advertises only explicitly supplied mods and channel versions', () => {
    const client = makeClient()
    forgeHandshake3(client, {
      forgeMods: ['declaredmod'],
      channels: { 'declaredmod:handshake': '7' }
    })
    const modList = Buffer.concat([
      Buffer.from([1, 1]), string('servermod'),
      Buffer.from([0]), // channels
      Buffer.from([0]), // registries
      Buffer.from([0]) // data-pack registries
    ])

    client.emit('login_plugin_request', {
      messageId: 1,
      channel: 'fml:loginwrapper',
      data: loginWrapper('fml:handshake', modList)
    })

    const expected = Buffer.concat([
      Buffer.from([2, 1]), string('declaredmod'),
      Buffer.from([1]), string('declaredmod:handshake'), string('7'),
      Buffer.from([0])
    ])
    assert.deepStrictEqual(client.writes[0].data.data, loginWrapper('fml:handshake', expected))
  })
})
