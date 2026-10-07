/* eslint-env mocha */
const assert = require('assert')
const { EventEmitter } = require('events')
const decode = require('../src/client/fabricRegistries')
const { fabricNetworking } = require('..')
const string = value => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)])
const payload = (attributes = 0) => Buffer.concat([
  Buffer.from([1]), string(''), Buffer.from([1]), string('sound_event'), Buffer.from([attributes, 2]),
  string(''), Buffer.from([1, 3, 2]), string('a'), string('b'),
  string('example'), Buffer.from([1, 0xfd, 0xff, 0xff, 0xff, 0x0f, 1]), string('c')
])

describe('Fabric registry synchronization', () => {
  it('decodes the complete live Better Combat 1.21.11 registry payload', () => {
    const fixture = require('./fixtures/fabric-1.21.11-registries.json')
    const bytes = require('zlib').gunzipSync(Buffer.from(fixture.gzipBase64, 'base64'))
    assert.equal(bytes.length, fixture.byteLength)
    assert.equal(require('crypto').createHash('sha256').update(bytes).digest('hex'), fixture.sha256)
    const registries = decode(bytes)
    assert.equal(registries.size, 3)
    assert.equal(registries.get('minecraft:data_component_type').entries.size, 105)
    assert.equal(registries.get('minecraft:data_component_type').entries.get('bettercombat:preset_id'), 104)
    assert.equal(registries.get('minecraft:sound_event').entries.size, 1864)
    assert.equal(registries.get('minecraft:particle_type').entries.size, 127)
  })
  it('decodes default namespaces, consecutive IDs and negative deltas between namespaces', () => {
    const registry = decode(payload(1)).get('minecraft:sound_event')
    assert.equal(registry.optional, true)
    assert.deepStrictEqual([...registry.entries], [['minecraft:a', 3], ['minecraft:b', 4], ['example:c', 1]])
  })

  it('rejects truncated, trailing and unknown-attribute data', () => {
    const bytes = payload()
    for (let end = 0; end < bytes.length; end++) assert.throws(() => decode(bytes.subarray(0, end)))
    assert.throws(() => decode(Buffer.concat([bytes, Buffer.from([0])])), /Trailing/)
    assert.throws(() => decode(payload(2)), /attributes/)
  })

  it('rejects duplicate registry names and invalid entry IDs', () => {
    const bytes = payload()
    const registryBody = bytes.subarray(3)
    assert.throws(() => decode(Buffer.concat([Buffer.from([1, 0, 2]), registryBody, registryBody])), /Duplicate Fabric registry/)
    const negative = Buffer.concat([Buffer.from([1, 0, 1]), string('sound_event'), Buffer.from([0, 1, 0, 1, 0xff, 0xff, 0xff, 0xff, 0x0f, 1]), string('a')])
    assert.throws(() => decode(negative), /invalid Fabric registry entry/)
  })

  it('acknowledges only after the application explicitly confirms applying the mappings', () => {
    for (const accepted of [true, false, undefined]) {
      const client = new EventEmitter()
      client.version = '1.21.11'
      client.state = 'configuration'
      const writes = []
      const errors = []
      client.write = (name, packet) => writes.push(packet)
      client.on('error', error => errors.push(error))
      let calls = 0
      fabricNetworking(client, {
        registryHandler: registries => {
          calls++
          assert.equal(registries.get('minecraft:sound_event').entries.get('example:c'), 1)
          assert.equal(writes.length, 0)
          return accepted
        }
      })
      client.emit('custom_payload', { channel: 'fabric:registry/sync', data: payload() })
      assert.equal(calls, 1)
      assert.equal(errors.length, accepted === true ? 0 : 1)
      assert.deepStrictEqual(writes, accepted === true ? [{ channel: 'fabric:registry/sync/complete', data: Buffer.alloc(0) }] : [])
    }
  })

  it('does not enable registry sync for an unverified wire version', () => {
    const client = new EventEmitter()
    client.version = '1.21.1'
    assert.throws(() => fabricNetworking(client, { registryHandler: () => true }), /only verified/)
  })

  it('does not call the application for malformed payloads', () => {
    const client = new EventEmitter()
    client.version = '1.21.11'
    client.state = 'configuration'
    const errors = []
    client.on('error', error => errors.push(error))
    client.write = () => assert.fail('must not acknowledge malformed data')
    fabricNetworking(client, { registryHandler: () => assert.fail('must not apply malformed data') })
    client.emit('custom_payload', { channel: 'fabric:registry/sync', data: Buffer.from([1]) })
    assert.equal(errors.length, 1)
  })

  it('permits registry synchronization once per configuration cycle', () => {
    const client = new EventEmitter()
    client.version = '1.21.11'
    client.state = 'configuration'
    const errors = []
    let writes = 0
    client.on('error', error => errors.push(error))
    client.write = () => writes++
    fabricNetworking(client, { registryHandler: () => true })
    const receive = () => client.emit('custom_payload', { channel: 'fabric:registry/sync', data: payload() })
    receive()
    client.emit('state', 'configuration')
    receive()
    assert.equal(writes, 2)
    assert.equal(errors.length, 0)
    receive()
    assert.equal(writes, 2)
    assert.match(errors[0].message, /Duplicate Fabric registry/)
  })
})
