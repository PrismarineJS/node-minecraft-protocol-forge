const { ProtoDef } = require('protodef')
const { installCommandRegistryEntries } = require('./commandRegistry')
const proto = new ProtoDef(false)
proto.addTypes(require('./data/neoforgeRegistries.json').types)

module.exports = function (client) {
  let pending
  let started = false
  client.neoforgeRegistries = new Map()
  client.neoforgeRegistrySyncComplete = false
  client.on('state', state => {
    if (state !== 'configuration') return
    pending = undefined
    started = false
    client.neoforgeRegistrySyncComplete = false
    client.neoforgeRegistries.clear()
  })
  const decode = (type, bytes) => {
    const parsed = proto.parsePacketBuffer(type, bytes)
    if (parsed.metadata.size !== bytes.length) throw new Error('Trailing NeoForge registry data')
    return parsed.data
  }
  return {
    'neoforge:frozen_registry_sync_start': {
      version: '1',
      flow: 'clientbound',
      optional: true,
      handler: bytes => {
        if (started) throw new Error('Duplicate NeoForge registry sync start')
        const names = decode('names', bytes)
        pending = new Set(names)
        if (pending.size !== names.length) throw new Error('Duplicate NeoForge registry name')
        started = true
      }
    },
    'neoforge:frozen_registry': {
      version: '1',
      flow: 'clientbound',
      optional: true,
      handler: bytes => {
        const registry = decode('registry', bytes)
        if (!pending?.has(registry.name)) throw new Error('Unexpected NeoForge registry')
        const ids = new Set(registry.ids.map(entry => entry.value))
        const names = new Set(registry.ids.map(entry => entry.key))
        if (ids.size !== registry.ids.length || names.size !== registry.ids.length || registry.ids.some(entry => entry.value < 0)) throw new Error('Duplicate or invalid NeoForge registry entry')
        if (registry.name === 'minecraft:command_argument_type') installCommandRegistryEntries(client, registry.ids)
        client.neoforgeRegistries.set(registry.name, registry)
        pending.delete(registry.name)
        client.emit('neoforgeRegistry', registry)
      }
    },
    'neoforge:frozen_registry_sync_completed': {
      version: '1',
      optional: true,
      handler: bytes => {
        if (bytes.length || !pending || pending.size) throw new Error('Incomplete NeoForge registry sync')
        pending = undefined
        client.write('custom_payload', { channel: 'neoforge:frozen_registry_sync_completed', data: Buffer.alloc(0) })
        client.neoforgeRegistrySyncComplete = true
      }
    }
  }
}
