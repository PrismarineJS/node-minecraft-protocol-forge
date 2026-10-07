/* eslint-env mocha */
const assert = require('assert')
const { gunzipSync } = require('zlib')
const minecraftData = require('minecraft-data')
const { createDeserializer } = require('minecraft-protocol')
const decodeRegistries = require('../src/client/fabricRegistries')
const { installFabricRegistryMappings } = require('..')

const fixture = require('./fixtures/fabric-1.21.11-registries.json')
const registries = () => decodeRegistries(gunzipSync(Buffer.from(fixture.gzipBase64, 'base64')))
const slash = ['container', [
  { name: 'scale', type: 'f32' },
  { name: 'pitch', type: 'f32' },
  { name: 'yaw', type: 'f32' },
  { name: 'localYaw', type: 'f32' },
  { name: 'roll', type: 'f32' },
  { name: 'light', type: 'bool' },
  { name: 'color', type: 'i64' }
]]
const options = {
  particleTypes: Object.fromEntries([
    'botslash45', 'botslash90', 'botslash180', 'botslash270', 'botslash360', 'botstab',
    'topslash45', 'topslash90', 'topslash180', 'topslash270', 'topslash360', 'topstab'
  ].map(name => [`bettercombat:${name}`, slash])),
  dataComponentTypes: { 'bettercombat:preset_id': 'anonymousNbt' }
}

function protocol (client) {
  return createDeserializer({ version: client.version, state: 'play', isServer: false, customPackets: client.customPackets }).proto
}

describe('Fabric registry mappings', () => {
  it('installs the complete captured mappings without mutating minecraft-data', () => {
    const shared = JSON.stringify(minecraftData('1.21.11').protocol)
    const client = { version: '1.21.11' }
    assert.equal(installFabricRegistryMappings(client, registries(), options), true)
    assert.equal(client.fabricRegistries.get('minecraft:sound_event').entries.get('bettercombat:sword_slash'), 1862)
    assert.equal(JSON.stringify(minecraftData('1.21.11').protocol), shared)
  })

  it('round-trips a custom particle using its synchronized ID and codec', () => {
    const client = { version: '1.21.11' }
    installFabricRegistryMappings(client, registries(), options)
    const proto = protocol(client)
    const params = {
      longDistance: false,
      alwaysShow: true,
      x: 1,
      y: 2,
      z: 3,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      velocityOffset: 0,
      amount: 1,
      particle: {
        type: 'bettercombat:botslash45',
        data: { scale: 1, pitch: 2, yaw: 3, localYaw: 4, roll: 5, light: true, color: 6n }
      }
    }
    const packet = proto.createPacketBuffer('packet', { name: 'world_particles', params })
    const parsed = proto.parsePacketBuffer('packet', packet)
    assert.equal(parsed.metadata.size, packet.length)
    assert.deepStrictEqual({ ...parsed.data.params, particle: { ...parsed.data.params.particle, data: { ...parsed.data.params.particle.data, color: undefined } } },
      { ...params, particle: { ...params.particle, data: { ...params.particle.data, color: undefined } } })
    assert.deepStrictEqual([...parsed.data.params.particle.data.color], [0, 6])
    assert.equal(packet.includes(Buffer.from([115])), true)
  })

  it('round-trips a custom item component using its synchronized ID and codec', () => {
    const client = { version: '1.21.11' }
    installFabricRegistryMappings(client, registries(), options)
    const proto = protocol(client)
    const params = {
      windowId: 0,
      stateId: 0,
      slot: 0,
      item: {
        itemCount: 1,
        itemId: 1,
        addedComponentCount: 1,
        removedComponentCount: 0,
        components: [{ type: 'bettercombat:preset_id', data: { type: 'string', value: 'bettercombat:sword' } }],
        removeComponents: []
      }
    }
    const packet = proto.createPacketBuffer('packet', { name: 'set_slot', params })
    const parsed = proto.parsePacketBuffer('packet', packet)
    assert.equal(parsed.metadata.size, packet.length)
    assert.deepStrictEqual(parsed.data.params, params)
  })

  it('parses the complete live custom particle and item packets', () => {
    const play = require('./fixtures/fabric-1.21.11-better-combat-play.json')
    const client = { version: play.version }
    installFabricRegistryMappings(client, registries(), options)
    const proto = protocol(client)
    const particleBytes = Buffer.from(play.packets.particle, 'hex')
    const particle = proto.parsePacketBuffer('packet', particleBytes)
    assert.equal(particle.metadata.size, particleBytes.length)
    assert.equal(particle.data.name, 'world_particles')
    assert.equal(particle.data.params.particle.type, 'bettercombat:botslash45')
    assert.deepStrictEqual([...particle.data.params.particle.data.color], [0, -1])
    const itemBytes = Buffer.from(play.packets.item, 'hex')
    const item = proto.parsePacketBuffer('packet', itemBytes)
    assert.equal(item.metadata.size, itemBytes.length)
    assert.equal(item.data.name, 'set_slot')
    assert.deepStrictEqual(item.data.params.item.components, [{ type: 'bettercombat:preset_id', data: { type: 'string', value: 'bettercombat:sword' } }])
  })

  it('isolates clients with different synchronized particle IDs', () => {
    const firstRegistries = registries()
    const secondRegistries = registries()
    const entries = secondRegistries.get('minecraft:particle_type').entries
    entries.set('bettercombat:botslash45', 116)
    entries.set('bettercombat:botslash90', 115)
    const first = { version: '1.21.11' }
    const second = { version: '1.21.11' }
    installFabricRegistryMappings(first, firstRegistries, options)
    installFabricRegistryMappings(second, secondRegistries, options)
    const particle = {
      type: 'bettercombat:botslash45',
      data: { scale: 1, pitch: 0, yaw: 0, localYaw: 0, roll: 0, light: false, color: 0n }
    }
    const firstBytes = protocol(first).createPacketBuffer('Particle', particle)
    const secondBytes = protocol(second).createPacketBuffer('Particle', particle)
    assert.equal(firstBytes[0], 115)
    assert.equal(secondBytes[0], 116)
    assert.notDeepStrictEqual(firstBytes, secondBytes)
    assert.equal(protocol(first).parsePacketBuffer('Particle', firstBytes).data.type, particle.type)
    assert.equal(protocol(second).parsePacketBuffer('Particle', secondBytes).data.type, particle.type)
  })

  it('replaces only schemas previously installed for the same client', () => {
    const client = { version: '1.21.11' }
    installFabricRegistryMappings(client, registries(), options)
    const before = protocol(client)
    const replacement = registries()
    const entries = replacement.get('minecraft:particle_type').entries
    entries.set('bettercombat:botslash45', 116)
    entries.set('bettercombat:botslash90', 115)
    installFabricRegistryMappings(client, replacement, options)
    const after = protocol(client)
    const particle = {
      type: 'bettercombat:botslash45',
      data: { scale: 1, pitch: 0, yaw: 0, localYaw: 0, roll: 0, light: false, color: 0n }
    }
    assert.equal(before.createPacketBuffer('Particle', particle)[0], 115)
    assert.equal(after.createPacketBuffer('Particle', particle)[0], 116)
  })

  it('accepts a supported partial registry set and removes stale owned schemas', () => {
    const client = { version: '1.21.11' }
    installFabricRegistryMappings(client, registries(), options)
    const soundOnly = new Map([['minecraft:sound_event', registries().get('minecraft:sound_event')]])
    installFabricRegistryMappings(client, soundOnly)
    const types = client.customPackets[minecraftData(client.version).version.majorVersion].types
    assert.equal(types.Particle, undefined)
    assert.equal(types.SlotComponent, undefined)
    assert.equal(client.fabricRegistries.size, 1)
    assert.equal(client.fabricRegistries.get('minecraft:sound_event').entries.get('bettercombat:sword_slash'), 1862)
  })

  it('reset removes the helper-owned schemas and registries but keeps caller schemas', () => {
    const key = minecraftData('1.21.11').version.majorVersion
    const client = { version: '1.21.11', customPackets: { [key]: { types: { 'caller:thing': 'void' } } } }
    installFabricRegistryMappings(client, registries(), options)
    assert.notEqual(client.customPackets[key].types.Particle, undefined)
    assert.notEqual(client.fabricRegistries, undefined)
    assert.equal(installFabricRegistryMappings.reset(client), true)
    assert.equal(client.customPackets[key].types.Particle, undefined)
    assert.equal(client.customPackets[key].types.SlotComponent, undefined)
    assert.equal(client.customPackets[key].types['caller:thing'], 'void') // caller-owned schema preserved
    assert.equal(client.fabricRegistries, undefined)
    assert.equal(installFabricRegistryMappings.reset(client), false) // idempotent once nothing is installed
  })

  it('rejects incomplete codecs, unknown registries, and caller schema conflicts', () => {
    assert.throws(() => installFabricRegistryMappings({ version: '1.21.11' }, registries()), /Missing .* codec/)
    const unknown = registries()
    unknown.set('example:unknown', { optional: false, entries: new Map() })
    assert.throws(() => installFabricRegistryMappings({ version: '1.21.11' }, unknown, options), /Unsupported Fabric registry/)
    const key = minecraftData('1.21.11').version.majorVersion
    const client = { version: '1.21.11', customPackets: { [key]: { types: { Particle: 'void' } } } }
    assert.throws(() => installFabricRegistryMappings(client, registries(), options), /already installed/)
  })
})
