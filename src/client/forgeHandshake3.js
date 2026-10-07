const ProtoDef = require('protodef').ProtoDef
const debug = require('debug')('minecraft-protocol-forge')
const { installCommandRegistry } = require('./commandRegistry')

// Channels
const FML_CHANNELS = {
  LOGINWRAPPER: 'fml:loginwrapper',
  HANDSHAKE: 'fml:handshake'
}

const PROTODEF_TYPES = {
  LOGINWRAPPER: 'fml_loginwrapper',
  HANDSHAKE: 'fml_handshake'
}

// Initialize Proto
const proto = new ProtoDef(false)

// copied from ../../dist/transforms/serializer.js
proto.addType('string', [
  'pstring',
  {
    countType: 'varint'
  }
])

// copied from node-minecraft-protocol
proto.addTypes({
  restBuffer: [
    (buffer, offset) => {
      return {
        value: buffer.slice(offset),
        size: buffer.length - offset
      }
    },
    (value, buffer, offset) => {
      value.copy(buffer, offset)
      return offset + value.length
    },
    (value) => {
      return value.length
    }
  ]
})

proto.addProtocol(require('./data/fml3.json'), ['fml3'])

// Forge 1.18.2 omits an empty data-pack registry list at the end of ModList.
// Later versions always send the count, including when it is zero.
const dataPackRegistryList = ['array', {
  countType: 'varint',
  type: ['container', [{ name: 'name', type: 'string' }]]
}]
proto.addType('optionalDataPackRegistries', [
  (buffer, offset) => offset === buffer.length
    ? { value: [], size: 0 }
    : proto.read(buffer, offset, dataPackRegistryList),
  (value, buffer, offset) => proto.write(value, buffer, offset, dataPackRegistryList),
  value => proto.sizeOf(value, dataPackRegistryList)
])

/**
 * FML3 handshake to the server.
 * ! There is no wiki for it.
 * @param {import('minecraft-protocol').Client} client client that is connecting to the server.
 * @param {{
 *  forgeMods: Array.<string> | undefined,
 *  channels: Object.<string, string> | undefined,
 *  registries: Object.<string, string> | undefined,
 *  loginHandlers: Object.<string, function(Buffer, Object): (Buffer|undefined)> | undefined
 * }} options
 */
module.exports = function (client, options = {}) {
  if (client.version) installCommandRegistry(client)
  const modNames = options.forgeMods
  const channels = options.channels
  const registries = options.registries
  const loginHandlers = options.loginHandlers || {}

  // passed to src/client/setProtocol.js, signifies client supports FML2/Forge
  client.tagHost = '\0FML3\0'
  debug('initialized FML3 handler')
  if (!modNames) {
    debug("trying to guess modNames by reflecting the servers'")
  } else {
    debug('modNames:', modNames)
  }
  if (!channels) {
    debug("trying to guess channels by reflecting the servers'")
  } else {
    Object.entries(channels).forEach((name, marker) => {
      debug('channel', name, marker)
    })
  }
  if (!registries) {
    debug("trying to guess registries by reflecting the servers'")
  } else {
    Object.entries(registries).forEach((name, marker) => {
      debug('registry', name, marker)
    })
  }

  client.registerChannel('fml:loginwrapper', proto.types.fml_loginwrapper, false)

  // remove default login_plugin_request listener which would answer with an empty packet
  // and make the server disconnect us
  const nmplistener = client.listeners('login_plugin_request').find((fn) => fn.name === 'onLoginPluginRequest')
  if (nmplistener) client.removeListener('login_plugin_request', nmplistener)

  client.on('login_plugin_request', (data) => {
    if (data.channel === 'fml:loginwrapper') {
      // parse buffer
      const { data: loginwrapper } = proto.parsePacketBuffer(
        PROTODEF_TYPES.LOGINWRAPPER,
        data.data
      )

      if (!loginwrapper.channel) {
        console.error(loginwrapper)
      }

      switch (loginwrapper.channel) {
        case 'fml:handshake': {
          const { data: handshake } = proto.parsePacketBuffer(
            PROTODEF_TYPES.HANDSHAKE,
            loginwrapper.data
          )

          let loginwrapperpacket = Buffer.alloc(0)
          switch (handshake.discriminator) {
            // respond with ModListResponse
            case 'ModList': {
              const modlist = handshake.data

              const modlistreply = {
                modNames,
                channels: [],
                registries: []
              }

              if (!modNames) {
                modlistreply.modNames = modlist.modNames
              }

              if (!options.channels) {
                for (const { name, marker } of modlist.channels) {
                  if (marker !== 'FML3') {
                    modlistreply.channels.push({ name, marker })
                  }
                }
              } else {
                for (const channel in channels) {
                  modlistreply.channels.push({
                    name: channel,
                    marker: channels[channel]
                  })
                }
              }

              if (!options.registries) {
                for (const { name } of modlist.registries) {
                  modlistreply.registries.push({ name, marker: '1.0' })
                }
              } else {
                for (const registry in registries) {
                  modlistreply.registries.push({
                    name: registry,
                    marker: registries[registry]
                  })
                }
              }

              const modlistreplypacket = proto.createPacketBuffer(
                PROTODEF_TYPES.HANDSHAKE,
                {
                  discriminator: 'ModListReply',
                  data: modlistreply
                }
              )

              loginwrapperpacket = proto.createPacketBuffer(
                PROTODEF_TYPES.LOGINWRAPPER,
                {
                  channel: FML_CHANNELS.HANDSHAKE,
                  data: modlistreplypacket
                }
              )
              break
            }

            // this shouldn't happen
            case 'ModListReply':
              throw Error('received clientbound-only ModListReply from server')

            // respond with Ack
            case 'ServerRegistry': {
              if (handshake.data.name === 'minecraft:command_argument_type' && handshake.data.snapshot) {
                installCommandRegistry(client, handshake.data.snapshot)
              }
              loginwrapperpacket = proto.createPacketBuffer(
                PROTODEF_TYPES.LOGINWRAPPER,
                {
                  channel: FML_CHANNELS.HANDSHAKE,
                  data: proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, {
                    discriminator: 'Acknowledgement',
                    data: {}
                  })
                }
              )
              break
            }

            // respond with Ack
            case 'ConfigurationData': {
              loginwrapperpacket = proto.createPacketBuffer(
                PROTODEF_TYPES.LOGINWRAPPER,
                {
                  channel: FML_CHANNELS.HANDSHAKE,
                  data: proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, {
                    discriminator: 'Acknowledgement',
                    data: {}
                  })
                }
              )
              break
            }

            // Forge marks ModData as noResponse(), so it must not be acknowledged.
            case 'ModData': {
              return
            }

            // respond with Ack ?
            case 'ChannelMismatchData': {
              loginwrapperpacket = proto.createPacketBuffer(
                PROTODEF_TYPES.LOGINWRAPPER,
                {
                  channel: FML_CHANNELS.HANDSHAKE,
                  data: proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, {
                    discriminator: 'Acknowledgement',
                    data: {}
                  })
                }
              )
              break
            }

            // this shouldn't happen
            case 'Acknowledgement':
              throw Error('received clientbound-only Acknowledgement from server')
          }

          client.write('login_plugin_response', {
            messageId: data.messageId,
            data: loginwrapperpacket
          })
          break
        }

        default: {
          client.emit('forgeLoginPluginRequest', {
            messageId: data.messageId,
            channel: loginwrapper.channel,
            data: loginwrapper.data
          })
          if (!loginHandlers[loginwrapper.channel]) {
            client.write('login_plugin_response', { messageId: data.messageId })
            break
          }
          const response = loginHandlers[loginwrapper.channel](loginwrapper.data, data)
          if (response !== undefined && !Buffer.isBuffer(response)) {
            throw new TypeError(`Login handler for ${loginwrapper.channel} must return a Buffer or undefined`)
          }
          client.write('login_plugin_response', {
            messageId: data.messageId,
            data: response === undefined
              ? undefined
              : proto.createPacketBuffer(PROTODEF_TYPES.LOGINWRAPPER, { channel: loginwrapper.channel, data: response })
          })
          break
        }
      }
    } else {
      console.log('other channel', data.channel, 'received')
    }
  })
}
