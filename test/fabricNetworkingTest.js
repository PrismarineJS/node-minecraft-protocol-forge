/* eslint-env mocha */
const assert = require('assert')
const { EventEmitter } = require('events')
const { fabricNetworking } = require('..')

const string = value => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)])
const registration = (phase, channels = []) => Buffer.concat([Buffer.from([1]), string(phase), Buffer.from([channels.length]), ...channels.map(string)])
function setup (options) {
  const client = new EventEmitter()
  client.state = 'configuration'
  client.writes = []
  client.errors = []
  client.write = (name, data) => client.writes.push({ name, ...data })
  client.on('error', error => client.errors.push(error))
  const networking = fabricNetworking(client, options)
  client.receive = (channel, data) => client.emit('custom_payload', { channel, data })
  return { client, networking }
}

describe('Fabric common networking', () => {
  it('answers legacy early registration with only supplied play handlers', () => {
    const { client, networking } = setup({ playHandlers: { 'example:client': () => {} } })
    client.emit('login_plugin_request', { messageId: 7, channel: 'fabric-networking-api-v1:early_registration', data: Buffer.concat([Buffer.from([1]), string('example:server')]) })
    assert.deepStrictEqual(client.writes, [{ name: 'login_plugin_response', messageId: 7, data: Buffer.concat([Buffer.from([1]), string('example:client')]) }])
    assert.equal(networking.remoteChannels.play.has('example:server'), true)
  })

  it('awaits explicit login handlers and declines unknown queries', async () => {
    const { client } = setup({ loginHandlers: { 'example:login': async () => Buffer.from([42]) } })
    client.emit('login_plugin_request', { messageId: 8, channel: 'example:login', data: Buffer.alloc(0) })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepStrictEqual(client.writes[0], { name: 'login_plugin_response', messageId: 8, data: Buffer.from([42]) })
    client.emit('login_plugin_request', { messageId: 9, channel: 'unknown:login', data: Buffer.alloc(0) })
    assert.deepStrictEqual(client.writes[1], { name: 'login_plugin_response', messageId: 9, data: undefined })
  })

  it('reports rejected asynchronous login handlers without a success response', async () => {
    const { client } = setup({ loginHandlers: { 'example:login': async () => { throw new Error('unsupported mod') } } })
    client.emit('login_plugin_request', { messageId: 8, channel: 'example:login', data: Buffer.alloc(0) })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(client.errors[0].message, /unsupported mod/)
    assert.equal(client.writes.length, 0)
  })

  it('advertises only implemented channels and negotiates the captured version bytes', () => {
    const { client } = setup({ configurationHandlers: { 'example:config': () => {} } })
    client.receive('minecraft:register', ['c:version', 'c:register', 'server:only'])
    assert.equal(client.writes[0].data.toString(), 'c:version\0c:register\0example:config')
    client.receive('c:version', Buffer.from([1, 1]))
    assert.deepStrictEqual(client.writes[1].data, Buffer.from([1, 1]))
    client.receive('c:register', registration('play', ['example:remote']))
    assert.deepStrictEqual(client.writes[2].data, registration('play', ['c:version', 'c:register']))
    assert.equal(client.errors.length, 0)
  })

  it('routes handlers by phase without automatically acknowledging mod data', () => {
    const calls = []
    const { client } = setup({ configurationHandlers: { 'example:data': (data, context) => calls.push(context.phase) }, playHandlers: { 'example:data': (data, context) => calls.push(context.phase) } })
    client.receive('example:data', Buffer.from([1]))
    client.state = 'play'
    client.receive('example:data', Buffer.from([2]))
    assert.deepStrictEqual(calls, ['configuration', 'play'])
    assert.equal(client.writes.length, 0)
  })

  it('rejects registration before negotiation and stops after failure', () => {
    const { client } = setup()
    client.receive('c:register', registration('play'))
    client.receive('c:version', Buffer.from([1, 1]))
    assert.equal(client.errors.length, 1)
    assert.equal(client.writes.length, 0)
  })

  for (const bytes of [[1, 2], [1], [1, 1, 0]]) {
    it(`rejects unsupported or malformed version bytes ${bytes}`, () => {
      const { client } = setup()
      client.receive('c:version', Buffer.from(bytes))
      assert.equal(client.errors.length, 1)
      assert.equal(client.writes.length, 0)
    })
  }

  it('rejects unknown registration phases', () => {
    const { client } = setup()
    client.receive('c:version', Buffer.from([1, 1]))
    client.receive('c:register', registration('invalid'))
    assert.equal(client.errors.length, 1)
    assert.equal(client.writes.length, 1)
  })

  it('clears per-connection state on reconfiguration and handles unregister', () => {
    const { client, networking } = setup()
    client.receive('minecraft:register', Buffer.from('example:remote'))
    assert.equal(networking.remoteChannels.configuration.has('example:remote'), true)
    client.receive('minecraft:unregister', Buffer.from('example:remote'))
    assert.equal(networking.remoteChannels.configuration.size, 0)
    client.emit('state', 'configuration')
    client.receive('minecraft:register', Buffer.from('c:version'))
    assert.equal(client.writes.length, 2)
    client.receive('c:register', registration('play'))
    assert.equal(client.errors.length, 1)
  })

  it('drops installed Fabric registry mappings when re-entering configuration', () => {
    const { installFabricRegistryMappings } = require('..')
    const { gunzipSync } = require('zlib')
    const decodeRegistries = require('../src/client/fabricRegistries')
    const fixture = require('./fixtures/fabric-1.21.11-registries.json')
    const all = decodeRegistries(gunzipSync(Buffer.from(fixture.gzipBase64, 'base64')))
    const soundOnly = new Map([['minecraft:sound_event', all.get('minecraft:sound_event')]])
    const { client } = setup()
    client.version = '1.21.11'
    installFabricRegistryMappings(client, soundOnly)
    assert.notEqual(client.fabricRegistries, undefined)
    client.emit('state', 'configuration') // transfer to a backend that sends no new registry sync
    assert.equal(client.fabricRegistries, undefined)
  })
})
