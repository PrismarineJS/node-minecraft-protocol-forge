const { ProtoDef } = require('protodef')
const compatibilityChecks = require('./neoforgeChecks')
const registryHandlers = require('./neoforgeRegistries')

const proto = new ProtoDef(false)
proto.addTypes(require('./data/neoforge.json').types)

const phases = { configuration: 4, play: 1 }
const builtins = ['neoforge:register', 'neoforge:network', 'neoforge:modded_network_setup_failed']

function decode (type, buffer) {
  const result = proto.parsePacketBuffer(type, buffer)
  if (result.metadata.size !== buffer.length) throw new Error(`Trailing NeoForge ${type} data`)
  return result.data
}

// NeoForge channel negotiation. Mod registry/config/gameplay handlers
// must be supplied explicitly; server channels are never blindly reflected.
module.exports = function (client, options = {}) {
  if (!['1.20.4', '1.21.1', '1.21.11'].includes(client.version)) throw new Error('Unsupported NeoForge Minecraft version')
  const legacy = client.version === '1.20.4'
  const registryChannels = registryHandlers(client)
  if (legacy) {
    // Verified against the 20.4.251 universal JAR's Specification-Version.
    for (const channel of Object.values(registryChannels)) channel.version = '20.4'
  }
  const playChannels = {}
  if (client.version === '1.21.11') {
    playChannels['neoforge:recipe_content'] = {
      version: '1',
      flow: 'clientbound',
      optional: true,
      handler: bytes => {
        // NeoForge sends two empty collections when no mod requests recipe sync.
        // Nonempty collections need registry-aware recipe serializers.
        if (!bytes.equals(Buffer.from([0, 0]))) throw new Error('Unsupported NeoForge recipe content; supply a recipe handler')
        client.emit('neoforgeRecipes', { recipeTypes: [], recipes: [] })
      }
    }
  }
  const registrations = {
    configuration: { ...(legacy ? {} : compatibilityChecks(client)), ...registryChannels, ...options.configurationChannels },
    play: { ...playChannels, ...options.playChannels }
  }
  const query = Object.entries(registrations).map(([phase, entries]) => ({
    phase: phases[phase],
    channels: Object.entries(entries).map(([name, entry]) => {
      if (!/^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(name) || builtins.includes(name)) throw new Error('Invalid NeoForge channel name')
      if (typeof entry.version !== 'string' || !entry.version.length) throw new TypeError('NeoForge channel version must be a nonempty string')
      if (entry.flow !== undefined && !['clientbound', 'serverbound'].includes(entry.flow)) throw new Error('Invalid NeoForge channel flow')
      if (entry.flow !== 'serverbound' && typeof entry.handler !== 'function') throw new TypeError('Incoming NeoForge channels require a handler')
      return { name, version: entry.version, flow: entry.flow === undefined ? undefined : entry.flow === 'serverbound' ? 0 : 1, optional: entry.optional === true }
    })
  }))
  let queried = false
  let setup
  let failed = false
  client.neoforgeHandshakeComplete = false
  client.on('state', state => {
    if (failed) return
    if (state === 'configuration') {
      queried = false
      setup = undefined
      client.neoforgeHandshakeComplete = false
    } else if (state === 'play') {
      if (!setup || (setup.get('configuration')?.has('neoforge:frozen_registry_sync_completed') && !client.neoforgeRegistrySyncComplete)) {
        failed = true
        client.emit('error', new Error('NeoForge entered play without channel negotiation or registry completion'))
      } else client.neoforgeHandshakeComplete = true
    }
  })
  // The current minecraft-protocol dependency does not answer configuration
  // pings. NeoForge waits for pong(0) before it starts configuration tasks.
  // Disable when an application already handles these vanilla packets.
  if (options.respondToPing !== false) {
    client.on('ping', packet => {
      if (!failed && client.state === 'configuration') client.write('pong', packet)
    })
  }
  client.on('custom_payload', packet => {
    if (failed || !Object.hasOwn(phases, client.state)) return
    try {
      if (packet.channel === 'neoforge:modded_network_setup_failed') {
        const error = new Error('NeoForge rejected channel negotiation')
        error.code = 'NEOFORGE_CHANNEL_MISMATCH'
        throw error
      }
      if (packet.channel === 'neoforge:register' && client.state === 'configuration') {
        const incoming = decode(legacy ? 'legacyQuery' : 'query', packet.data)
        if (queried || (legacy ? incoming.configuration.length + incoming.play.length : incoming.length) !== 0) throw new Error('Unexpected NeoForge network query')
        queried = true
        const reply = legacy ? { configuration: query[0].channels, play: query[1].channels } : query
        client.write('custom_payload', { channel: packet.channel, data: proto.createPacketBuffer(legacy ? 'legacyQuery' : 'query', reply) })
        return
      }
      if (packet.channel === 'neoforge:network' && client.state === 'configuration') {
        if (!queried || setup) throw new Error('Unexpected NeoForge network setup')
        const incoming = decode(legacy ? 'legacySetup' : 'setup', packet.data)
        const decoded = legacy
          ? Object.entries(incoming).map(([phase, channels]) => ({ phase: phases[phase], channels: channels.map(channel => ({ ...channel, key: channel.name })) }))
          : incoming
        const selected = new Map()
        for (const group of decoded) {
          const phase = Object.keys(phases).find(name => phases[name] === group.phase)
          if (!phase || selected.has(phase)) throw new Error('Invalid NeoForge setup phase')
          const names = new Set()
          for (const channel of group.channels) {
            const offered = registrations[phase][channel.name]
            if (channel.key !== channel.name || names.has(channel.name) || !offered || offered.version !== channel.version) throw new Error('Unoffered or mismatched NeoForge channel')
            names.add(channel.name)
          }
          selected.set(phase, names)
        }
        for (const [phase, entries] of Object.entries(registrations)) {
          for (const [name, entry] of Object.entries(entries)) {
            if (entry.optional !== true && !selected.get(phase)?.has(name)) throw new Error('Missing required NeoForge channel in setup')
          }
        }
        setup = selected
        client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from([...builtins, ...(setup.get('configuration') || [])].join('\0')) })
        client.emit('neoforgeChannels', decoded)
        return
      }
      if (setup?.get(client.state)?.has(packet.channel)) {
        const entry = registrations[client.state][packet.channel]
        if (entry.flow === 'serverbound') throw new Error('NeoForge sent a serverbound-only channel')
        entry.handler(packet.data, { client, phase: client.state })
      }
    } catch (error) {
      failed = true
      client.emit('error', error)
    }
  })
}
