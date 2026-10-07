/* eslint-env mocha */
const assert = require('assert')
const { EventEmitter } = require('events')
const registries = require('../src/client/neoforgeRegistries')
const string = value => Buffer.concat([Buffer.from([Buffer.byteLength(value)]), Buffer.from(value)])
const start = 'neoforge:frozen_registry_sync_start'
const data = 'neoforge:frozen_registry'
const done = 'neoforge:frozen_registry_sync_completed'

function setup () {
  const client = new EventEmitter()
  client.version = '1.21.1'
  client.writes = []
  client.write = (name, packet) => client.writes.push(packet)
  return { client, handlers: registries(client) }
}

describe('NeoForge frozen registry synchronization', () => {
  it('parses the complete live NeoForge command tree using its received registry', () => {
    const fixture = require('./fixtures/neoforge-1.21.1-commands.json')
    const { createDeserializer } = require('minecraft-protocol')
    const minecraftData = require('minecraft-data')
    const original = JSON.stringify(minecraftData(fixture.version).protocol)
    const { client, handlers } = setup()
    handlers[start].handler(Buffer.concat([Buffer.from([1]), string('minecraft:command_argument_type')]))
    handlers[data].handler(Buffer.from(fixture.registry, 'hex'))
    handlers[done].handler(Buffer.alloc(0))
    const decoder = createDeserializer({ version: fixture.version, state: 'play', isServer: false, customPackets: client.customPackets }).proto
    const packet = Buffer.from(fixture.commands, 'hex')
    const parsed = decoder.parsePacketBuffer('packet', packet)
    assert.equal(parsed.metadata.size, packet.length)
    assert.equal(parsed.data.params.rootIndex, 0)
    assert.ok(parsed.data.params.nodes.length > 1)
    assert.equal(JSON.stringify(minecraftData(fixture.version).protocol), original)
    assert.equal(client.neoforgeRegistrySyncComplete, true)
  })

  it('stores IDs and aliases and acknowledges only after the whole list', () => {
    const { client, handlers } = setup()
    handlers[start].handler(Buffer.concat([Buffer.from([1]), string('example:test')]))
    assert.throws(() => handlers[done].handler(Buffer.alloc(0)), /Incomplete/)
    handlers[data].handler(Buffer.concat([string('example:test'), Buffer.from([1, 7]), string('example:item'), Buffer.from([1]), string('example:old'), string('example:item')]))
    assert.deepStrictEqual(client.neoforgeRegistries.get('example:test'), { name: 'example:test', ids: [{ value: 7, key: 'example:item' }], aliases: [{ key: 'example:old', value: 'example:item' }] })
    assert.equal(client.writes.length, 0)
    handlers[done].handler(Buffer.alloc(0))
    assert.deepStrictEqual(client.writes, [{ channel: done, data: Buffer.alloc(0) }])
    assert.throws(() => handlers[done].handler(Buffer.alloc(0)), /Incomplete/)
    client.emit('state', 'configuration')
    assert.equal(client.neoforgeRegistries.size, 0)
  })

  it('rejects unannounced snapshots, duplicate entries and truncated data', () => {
    const { client, handlers } = setup()
    const empty = Buffer.concat([string('example:test'), Buffer.from([0, 0])])
    assert.throws(() => handlers[data].handler(empty), /Unexpected/)
    handlers[start].handler(Buffer.concat([Buffer.from([1]), string('example:test')]))
    assert.throws(() => handlers[data].handler(empty.subarray(0, empty.length - 1)))
    const duplicate = Buffer.concat([string('example:test'), Buffer.from([2, 7]), string('example:a'), Buffer.from([7]), string('example:b'), Buffer.from([0])])
    assert.throws(() => handlers[data].handler(duplicate), /Duplicate/)
    assert.equal(client.neoforgeRegistries.size, 0)
    assert.equal(client.writes.length, 0)
  })

  it('requires a new configuration cycle before restarting completed synchronization', () => {
    const { client, handlers } = setup()
    handlers[start].handler(Buffer.from([0]))
    handlers[done].handler(Buffer.alloc(0))
    assert.equal(client.neoforgeRegistrySyncComplete, true)
    assert.throws(() => handlers[start].handler(Buffer.from([0])), /Duplicate/)
    client.emit('state', 'configuration')
    assert.equal(client.neoforgeRegistrySyncComplete, false)
    handlers[start].handler(Buffer.from([0]))
    handlers[done].handler(Buffer.alloc(0))
    assert.equal(client.neoforgeRegistrySyncComplete, true)
    assert.equal(client.writes.length, 2)
  })
})
