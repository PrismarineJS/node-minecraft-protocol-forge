const { ProtoDef } = require('protodef')
const decodeRegistries = require('./fabricRegistries')
const registryMappings = require('./fabricRegistryMappings')

const proto = new ProtoDef(false)
proto.addTypes(require('./data/fabric.json').types)

function decode (type, buffer) {
  const parsed = proto.parsePacketBuffer(type, buffer)
  if (parsed.metadata.size !== buffer.length) throw new Error(`Trailing Fabric ${type} data`)
  return parsed.data
}

// Fabric API common networking, version 1. This is not a mod implementation:
// callers explicitly register their configuration/play payload handlers.
module.exports = function (client, options = {}) {
  let registryReceived = false
  const handlers = {
    configuration: { ...options.configurationHandlers },
    play: { ...options.playHandlers }
  }
  if (options.registryHandler !== undefined) {
    if (client.version !== '1.21.11') throw new Error('Fabric registry synchronization is only verified for 1.21.11')
    if (typeof options.registryHandler !== 'function') throw new TypeError('Fabric registryHandler must be a function')
    if (Object.hasOwn(handlers.configuration, 'fabric:registry/sync')) throw new Error('Duplicate Fabric registry handler')
    handlers.configuration['fabric:registry/sync'] = bytes => {
      if (registryReceived) throw new Error('Duplicate Fabric registry synchronization')
      const registries = decodeRegistries(bytes)
      registryReceived = true
      if (options.registryHandler(registries, { client }) !== true) {
        const error = new Error('Fabric registry handler did not confirm applied mappings')
        error.code = 'FABRIC_REGISTRY_NOT_APPLIED'
        throw error
      }
      client.write('custom_payload', { channel: 'fabric:registry/sync/complete', data: Buffer.alloc(0) })
      client.emit('fabricRegistries', registries)
    }
  }
  const channels = Object.fromEntries(Object.entries(handlers).map(([phase, entries]) => {
    for (const [name, handler] of Object.entries(entries)) {
      if (!/^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(name) || typeof handler !== 'function') throw new TypeError('Invalid Fabric channel handler')
      if (['c:version', 'c:register', 'minecraft:register', 'minecraft:unregister'].includes(name)) throw new Error('Reserved Fabric channel')
    }
    return [phase, ['c:version', 'c:register', ...Object.keys(entries)]]
  }))
  const remoteChannels = { configuration: new Set(), play: new Set() }
  let negotiatedVersion
  const registered = new Set()
  let failed = false
  const write = (channel, type, data) => client.write('custom_payload', { channel, data: proto.createPacketBuffer(type, data) })
  const earlyRegistration = 'fabric-networking-api-v1:early_registration'
  const loginHandlers = { ...options.loginHandlers }
  for (const handler of Object.values(loginHandlers)) {
    if (typeof handler !== 'function') throw new TypeError('Fabric login handlers must be functions')
  }
  if (Object.hasOwn(loginHandlers, earlyRegistration)) throw new Error('Reserved Fabric early registration channel')
  const defaultLogin = client.listeners('login_plugin_request').find(listener => listener.name === 'onLoginPluginRequest')
  if (defaultLogin) client.removeListener('login_plugin_request', defaultLogin)
  client.on('login_plugin_request', async packet => {
    if (failed) return
    try {
      let response
      if (packet.channel === earlyRegistration) {
        for (const name of decode('names', packet.data)) remoteChannels.play.add(name)
        response = proto.createPacketBuffer('names', Object.keys(handlers.play))
      } else if (Object.hasOwn(loginHandlers, packet.channel)) {
        response = await loginHandlers[packet.channel](packet.data, { client, messageId: packet.messageId })
        if (response !== undefined && !Buffer.isBuffer(response)) throw new TypeError('Fabric login handler must return a Buffer or undefined')
      } else if (defaultLogin) {
        defaultLogin.call(client, packet)
        return
      }
      if (!failed) client.write('login_plugin_response', { messageId: packet.messageId, data: response })
    } catch (error) {
      failed = true
      client.emit('error', error)
    }
  })

  client.on('state', state => {
    if (state === 'configuration') {
      registryReceived = false
      negotiatedVersion = undefined
      registered.clear()
      remoteChannels.configuration.clear()
      remoteChannels.play.clear()
      // Drop the previous backend's Fabric registry mappings/schemas (a transfer to a backend that sends no new sync must
      // not keep them); caller-owned custom schemas are preserved. No-op if no mappings were installed.
      registryMappings.reset(client)
    }
  })

  client.on('custom_payload', packet => {
    const phase = client.state
    if (failed || !Object.hasOwn(handlers, phase)) return
    try {
      if (packet.channel === 'minecraft:register' || packet.channel === 'minecraft:unregister') {
        // Accept raw registration bytes and arrays decoded by minecraft-protocol.
        const names = Array.isArray(packet.data) ? packet.data : packet.data.toString('utf8').split('\0').filter(Boolean)
        for (const name of names) {
          if (packet.channel === 'minecraft:register') remoteChannels[phase].add(name)
          else remoteChannels[phase].delete(name)
        }
        if (!registered.has(phase) && packet.channel === 'minecraft:register') {
          registered.add(phase)
          client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(channels[phase].join('\0')) })
        }
        return
      }
      if (packet.channel === 'c:version') {
        const versions = decode('versions', packet.data)
        if (!versions.includes(1)) throw new Error('Unsupported Fabric common networking version')
        negotiatedVersion = 1
        write('c:version', 'versions', [1])
        return
      }
      if (packet.channel === 'c:register') {
        const registration = decode('registration', packet.data)
        if (negotiatedVersion !== 1 || registration.version !== negotiatedVersion) throw new Error('Fabric registration before matching version negotiation')
        if (!Object.hasOwn(channels, registration.phase)) throw new Error('Unsupported Fabric registration phase')
        for (const name of registration.channels) remoteChannels[registration.phase].add(name)
        write('c:register', 'registration', { version: 1, phase: registration.phase, channels: channels[registration.phase] })
        client.emit('fabricChannels', registration.phase, [...remoteChannels[registration.phase]])
        return
      }
      if (Object.hasOwn(handlers[phase], packet.channel)) handlers[phase][packet.channel](packet.data, { client, phase })
    } catch (error) {
      failed = true
      client.emit('error', error)
    }
  })
  return { remoteChannels }
}
