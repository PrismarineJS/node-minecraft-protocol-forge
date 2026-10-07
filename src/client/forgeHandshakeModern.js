const { ProtoDef } = require('protodef')
const { readRegistry, installCommandRegistry } = require('./commandRegistry')

const proto = new ProtoDef(false)
proto.addType('restBuffer', [
  (buffer, offset) => ({ value: buffer.subarray(offset), size: buffer.length - offset }),
  (value, buffer, offset) => { value.copy(buffer, offset); return offset + value.length },
  value => value.length
])
proto.addTypes(require('./data/forgeModern.json').types)

// Forge's post-FML3 configuration protocol, advertised as network version 0.
module.exports = function (client, options = {}) {
  client.tagHost = '\0FORGE\0'
  let receivedMods = false
  let receivedChannels = false
  let failed = false
  let pendingRegistries
  client.forgeRegistries = new Map()
  client.forgeHandshakeComplete = false
  const channels = options.channels || { 'forge:handshake': 0, 'forge:login': 0 }
  const send = (id, data) => client.write('custom_payload', {
    channel: 'forge:handshake', data: proto.createPacketBuffer('packet', { id, data })
  })
  const ack = token => send(0, { token })

  client.on('custom_payload', packet => {
    if (failed || client.state !== 'configuration') return
    if (packet.channel === 'minecraft:register') {
      client.write('custom_payload', {
        channel: 'minecraft:register', data: Buffer.from(Object.keys(channels).join('\0') + '\0')
      })
      return
    }
    if (packet.channel !== 'forge:handshake') return
    try {
      const parsed = proto.parsePacketBuffer('packet', packet.data)
      if (parsed.metadata.size !== packet.data.length) throw new Error('Incomplete modern Forge packet decode')
      const { id, data } = parsed.data
      switch (id) {
        case 1:
          receivedMods = true
          client.emit('forgeMods', data)
          send(1, options.modVersions || data)
          break
        case 2:
          receivedChannels = true
          client.emit('forgeChannels', data)
          send(2, Object.entries(channels).map(([name, version]) => ({ name, version })))
          break
        case 3:
          if (pendingRegistries) throw new Error('Duplicate modern Forge registry list')
          if (data.datapacks.some(name => !(options.dataPackRegistries || []).includes(name))) {
            throw new Error('Unsupported modern Forge data-pack registry')
          }
          pendingRegistries = new Set(data.normal)
          if (pendingRegistries.size !== data.normal.length) throw new Error('Duplicate modern Forge registry name')
          ack(data.token)
          break
        case 4:
          if (!pendingRegistries?.has(data.name)) throw new Error(`Unexpected modern Forge registry: ${data.name}`)
          client.forgeRegistries.set(data.name, readRegistry(data.snapshot))
          if (data.name === 'minecraft:command_argument_type') installCommandRegistry(client, data.snapshot)
          pendingRegistries.delete(data.name)
          client.emit('forgeRegistry', data.name, client.forgeRegistries.get(data.name))
          ack(data.token)
          break
        case 5:
          client.emit('forgeConfig', data.name, data.data)
          break // ConfigData has no acknowledgment.
        case 6: {
          const error = new Error('Modern Forge rejected channel negotiation')
          error.code = 'FORGE_CHANNEL_MISMATCH'
          throw error
        }
        default:
          throw new Error(`Unsupported modern Forge handshake packet: ${id}`)
      }
    } catch (error) {
      failed = true
      client.emit('error', error)
    }
  })
  client.on('state', state => {
    if (!failed && state === 'configuration' && client.forgeHandshakeComplete) {
      receivedMods = false
      receivedChannels = false
      pendingRegistries = undefined
      client.forgeRegistries.clear()
      client.forgeHandshakeComplete = false
      return
    }
    if (failed || state !== 'play') return
    if (!receivedMods || !receivedChannels || !pendingRegistries || pendingRegistries.size) {
      failed = true
      client.emit('error', new Error('Modern Forge entered play before completing configuration'))
      return
    }
    client.forgeHandshakeComplete = true
  })
}
