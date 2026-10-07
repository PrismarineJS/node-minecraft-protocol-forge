/* eslint-env mocha */
const assert = require('assert')
const { EventEmitter } = require('events')
const { neoforgeHandshake } = require('..')

function setup (options, version = '1.21.1') {
  const client = new EventEmitter()
  client.version = version
  client.state = 'configuration'
  client.writes = []
  client.errors = []
  client.write = (name, data) => client.writes.push({ name, ...data })
  client.on('error', error => client.errors.push(error))
  neoforgeHandshake(client, options)
  client.receive = (channel, bytes) => client.emit('custom_payload', { channel, data: Buffer.from(bytes) })
  return client
}

const string = value => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)])
function modernSetup (phase, channels) {
  return Buffer.concat([Buffer.from([1, phase, channels.length]), ...channels.flatMap(name => [string(name), string(name), string('1')])])
}

describe('NeoForge 1.21.1 negotiation', () => {
  it('uses modern query framing for 1.21.11 and rejects unverified versions', () => {
    const client = setup({}, '1.21.11')
    client.receive('neoforge:register', [0])
    assert.deepStrictEqual(client.writes[0].data.subarray(0, 3), Buffer.from([2, 4, 7]))
    assert.throws(() => setup({}, '1.20.2'), /Unsupported NeoForge Minecraft version/)
  })

  it('handles only the empty 1.21.11 recipe sync and rejects nonempty or malformed content', () => {
    for (const bytes of [[0, 0], [], [0], [0, 0, 1], [1, 0, 0], [0, 1]]) {
      const client = setup({}, '1.21.11')
      const received = []
      client.on('neoforgeRecipes', recipes => received.push(recipes))
      client.receive('neoforge:register', [0])
      client.receive('neoforge:network', modernSetup(1, ['neoforge:recipe_content']))
      client.state = 'play'
      client.emit('state', 'play')
      client.receive('neoforge:recipe_content', bytes)
      if (bytes.length === 2 && bytes.every(byte => byte === 0)) {
        assert.deepStrictEqual(received, [{ recipeTypes: [], recipes: [] }])
        assert.equal(client.errors.length, 0)
      } else {
        assert.match(client.errors[0].message, /Unsupported NeoForge recipe content/)
        assert.equal(received.length, 0)
      }
    }
  })

  it('allows an explicit recipe implementation to replace the empty-only handler', () => {
    const received = []
    const client = setup({ playChannels: { 'neoforge:recipe_content': { version: '1', handler: bytes => received.push(bytes) } } }, '1.21.11')
    client.receive('neoforge:register', [0])
    client.receive('neoforge:network', modernSetup(1, ['neoforge:recipe_content']))
    client.state = 'play'
    client.receive('neoforge:recipe_content', [42])
    assert.deepStrictEqual(received, [Buffer.from([42])])
    assert.equal(client.errors.length, 0)
  })

  it('uses separate lists and optional channel versions for 1.20.4', () => {
    const client = setup({}, '1.20.4')
    client.receive('neoforge:register', [0, 0])
    assert.equal(client.writes[0].data[0], 3)
    assert.ok(client.writes[0].data.includes(Buffer.from('20.4')))
    client.receive('neoforge:network', [0, 0])
    client.emit('state', 'play')
    assert.equal(client.neoforgeHandshakeComplete, true)
    assert.equal(client.errors.length, 0)
  })
  it('answers the captured empty query and accepts the captured empty setup', () => {
    const client = setup()
    client.receive('neoforge:register', [0])
    assert.deepStrictEqual(client.writes[0].data.subarray(0, 3), Buffer.from([2, 4, 7]))
    assert.ok(client.writes[0].data.includes(Buffer.from('neoforge:extensible_enum_data')))
    client.receive('neoforge:network', [2, 4, 0, 1, 0])
    assert.equal(client.writes[1].channel, 'minecraft:register')
    client.emit('state', 'play')
    assert.equal(client.neoforgeHandshakeComplete, true)
    assert.equal(client.errors.length, 0)
  })

  it('responds to configuration ping with the exact token', () => {
    const client = setup()
    client.emit('ping', { id: 123 })
    assert.deepStrictEqual(client.writes, [{ name: 'pong', id: 123 }])
    const other = setup({ respondToPing: false })
    other.emit('ping', { id: 123 })
    assert.equal(other.writes.length, 0)
  })

  it('rejects server mismatch without claiming completion', () => {
    const client = setup()
    client.receive('neoforge:modded_network_setup_failed', [0])
    assert.equal(client.errors[0].code, 'NEOFORGE_CHANNEL_MISMATCH')
    client.emit('state', 'play')
    assert.equal(client.neoforgeHandshakeComplete, false)
  })

  it('rejects unsolicited setup and truncated queries', () => {
    const client = setup()
    client.receive('neoforge:network', [0])
    assert.match(client.errors[0].message, /Unexpected/)
    const other = setup()
    other.receive('neoforge:register', [])
    assert.equal(other.errors.length, 1)
    assert.equal(other.writes.length, 0)
  })

  it('does not accept setup omitting a required offered channel', () => {
    const client = setup({ configurationChannels: { 'example:test': { version: '1', handler: () => {} } } })
    client.receive('neoforge:register', [0])
    client.receive('neoforge:network', [2, 4, 0, 1, 0])
    assert.match(client.errors[0].message, /Missing required/)
  })

  it('requires a handler for incoming advertised channels', () => {
    assert.throws(() => setup({ playChannels: { 'example:test': { version: '1' } } }), /require a handler/)
  })

  it('resets negotiation for reconfiguration and rejects premature play', () => {
    const client = setup()
    client.receive('neoforge:register', [0])
    client.receive('neoforge:network', [2, 4, 0, 1, 0])
    client.emit('state', 'play')
    client.emit('state', 'configuration')
    assert.equal(client.neoforgeHandshakeComplete, false)
    client.emit('state', 'play')
    assert.match(client.errors[0].message, /without channel negotiation/)
  })

  it('requires negotiated registry synchronization before marking the handshake complete', () => {
    const client = setup()
    client.receive('neoforge:register', [0])
    client.receive('neoforge:network', modernSetup(4, ['neoforge:frozen_registry_sync_completed']))
    client.emit('state', 'play')
    assert.equal(client.neoforgeHandshakeComplete, false)
    assert.match(client.errors[0].message, /registry completion/)
  })

  it('does not acknowledge more traffic after a negotiated handler fails', () => {
    const client = setup({ configurationChannels: { 'example:test': { version: '1', handler: () => { throw new Error('invalid mod payload') } } } })
    client.receive('neoforge:register', [0])
    client.receive('neoforge:network', modernSetup(4, ['example:test']))
    const before = client.writes.length
    client.receive('example:test', [0])
    client.receive('example:test', [0])
    client.emit('ping', { id: 9 })
    client.emit('state', 'play')
    assert.equal(client.errors.length, 1)
    assert.match(client.errors[0].message, /invalid mod payload/)
    assert.equal(client.writes.length, before)
    assert.equal(client.neoforgeHandshakeComplete, false)
  })
})

describe('NeoForge compatibility checks', () => {
  const checks = require('../src/client/neoforgeChecks')
  const string = value => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)])

  it('acknowledges only unextended enums and empty modded flags', () => {
    const client = new EventEmitter()
    const writes = []
    client.write = (name, data) => writes.push(data)
    const handlers = checks(client)
    handlers['neoforge:extensible_enum_data'].handler(Buffer.concat([Buffer.from([1]), string('example.Enum'), string('CLIENTBOUND'), Buffer.from([0])]))
    handlers['neoforge:feature_flags'].handler(Buffer.from([0]))
    assert.deepStrictEqual(writes.map(packet => packet.channel), ['neoforge:extensible_enum_ack', 'neoforge:feature_flags_ack'])
    assert.ok(writes.every(packet => packet.data.length === 0))
  })

  it('rejects extended enums, modded flags, and trailing bytes without acknowledgments', () => {
    const client = new EventEmitter()
    client.write = () => assert.fail('must not acknowledge unsupported data')
    const handlers = checks(client)
    assert.throws(() => handlers['neoforge:extensible_enum_data'].handler(Buffer.concat([Buffer.from([1]), string('example.Enum'), string('CLIENTBOUND'), Buffer.from([1, 1, 2, 1]), string('MODDED')])), /Unsupported/)
    assert.throws(() => handlers['neoforge:feature_flags'].handler(Buffer.concat([Buffer.from([1]), string('example:flag')])), /Unsupported/)
    assert.throws(() => handlers['neoforge:feature_flags'].handler(Buffer.from([0, 1])), /Trailing/)
  })
})
