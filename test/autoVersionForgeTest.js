'use strict'
/* eslint-env mocha */

const assert = require('assert')
const { EventEmitter } = require('events')
const autoVersionForge = require('../src/client/autoVersionForge')

function string (value) {
  const bytes = Buffer.from(value)
  assert.ok(bytes.length < 128)
  return Buffer.concat([Buffer.from([bytes.length]), bytes])
}

function wrapper (payload) {
  assert.ok(payload.length < 128)
  return Buffer.concat([string('fml:handshake'), Buffer.from([payload.length]), payload])
}

function clientFor (response, options) {
  const client = new EventEmitter()
  client.writes = []
  client.write = (name, data) => client.writes.push({ name, data })
  client.registerChannel = () => {}
  client.on('login_plugin_request', function onLoginPluginRequest () {})
  autoVersionForge(client, options)
  for (const hook of client.autoVersionHooks) hook(response, client)
  return client
}

describe('automatic Forge protocol selection', () => {
  it('selects modern Forge from network version 0 without installing FML3', () => {
    const client = clientFor({ forgeData: { fmlNetworkVersion: 0, d: 'compressed-ping', mods: [] } }, { channels: { 'forge:handshake': 99 } })
    assert.equal(client.tagHost, '\0FORGE\0')
    assert.equal(client.listenerCount('login_plugin_request'), 1)
    client.state = 'configuration'
    client.emit('custom_payload', { channel: 'forge:handshake', data: Buffer.from([2, 0]) })
    assert.deepStrictEqual(client.writes[0].data.data, Buffer.concat([Buffer.from([2, 1]), string('forge:handshake'), Buffer.from([99])]))
  })

  it('does not guess a handshake for an unknown network version', () => {
    const client = clientFor({ forgeData: { fmlNetworkVersion: 99, d: 'compressed-ping' } })
    assert.equal(client.tagHost, undefined)
    assert.equal(client.listenerCount('login_plugin_request'), 1)
  })

  it('accepts decoded FML3 ping mods without requiring the compressed d field', () => {
    const client = clientFor({ forgeData: { fmlNetworkVersion: 3, mods: [{ modId: 'servermod', modVersion: '1' }] } })
    assert.equal(client.tagHost, '\0FML3\0')
    const payload = Buffer.concat([Buffer.from([1, 1]), string('servermod'), Buffer.from([0, 0, 0])])
    client.emit('login_plugin_request', { channel: 'fml:loginwrapper', messageId: 4, data: wrapper(payload) })
    assert.deepStrictEqual(client.writes[0].data.data, wrapper(Buffer.concat([Buffer.from([2, 1]), string('servermod'), Buffer.from([0, 0])])))
  })

  it('leaves vanilla clients alone', () => {
    const client = clientFor({ version: { protocol: 763 } })
    assert.equal(client.tagHost, undefined)
    assert.equal(client.listenerCount('login_plugin_request'), 1)
  })

  it('preserves FML1 mod list objects during a reset handshake', () => {
    const client = clientFor({ modinfo: { type: 'FML', modList: [{ modid: 'example', version: '1' }] } })
    assert.equal(client.tagHost, '\0FML\0')
    client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from([254]) })
    client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from([0, 2, 0, 0, 0, 0]) })
    const modList = client.writes.find(packet => packet.data.channel === 'FML|HS' && packet.data.data[0] === 2)
    assert.ok(modList)
    assert.deepStrictEqual(modList.data.data, Buffer.concat([Buffer.from([2, 1]), string('example'), string('1')]))
  })

  it('accepts the opening FML1 ServerHello without a preceding reset', () => {
    const client = clientFor({ modinfo: { type: 'FML', modList: [] } })
    client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from([0, 2, 0, 0, 0, 0]) })
    assert.equal(client.fmlHandshakeState, 2)
    assert.equal(client.fmlHandshakeReset, undefined)
    assert.ok(client.writes.some(packet => packet.data.channel === 'FML|HS' && packet.data.data.equals(Buffer.from([1, 2]))))
  })

  for (const family of [2, 3]) {
    for (const override of [undefined, [], ['explicitmod']]) {
      it(`preserves FML${family} mod advertisement with override ${JSON.stringify(override)}`, () => {
        const response = family === 2
          ? { forgeData: { fmlNetworkVersion: 2, mods: [{ modId: 'servermod', modmarker: 'ANY' }] } }
          : { forgeData: { fmlNetworkVersion: 3, d: 'compressed-ping', mods: [] } }
        const client = clientFor(response, override === undefined ? {} : { forgeMods: override })
        assert.equal(client.tagHost, `\0FML${family}\0`)
        const payload = Buffer.concat([Buffer.from([1, 1]), string('servermod'), Buffer.from(family === 2 ? [0, 0] : [0, 0, 0])])
        client.emit('login_plugin_request', { channel: 'fml:loginwrapper', messageId: 4, data: wrapper(payload) })
        const names = override === undefined ? ['servermod'] : override
        const expected = Buffer.concat([Buffer.from([2, names.length]), ...names.map(string), Buffer.from([0, 0])])
        assert.deepStrictEqual(client.writes[0], { name: 'login_plugin_response', data: { messageId: 4, data: wrapper(expected) } })
      })
    }
  }
})
