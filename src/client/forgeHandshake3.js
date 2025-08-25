const ProtoDef = require('protodef').ProtoDef
const debug = require('../../debug')

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

/**
 * FML3 handshake to the server.
 * Forge 1.20.1+ protocol implementation
 * @param {import('minecraft-protocol').Client} client client that is connecting to the server.
 * @param {{
 *  forgeMods: Array.<string> | undefined,
 *  channels: Object.<string, string> | undefined,
 *  registries: Object.<string, string> | undefined
 * }} options
 */
module.exports = function (client, options) {
  const modNames = options.forgeMods
  const channels = options.channels
  const registries = options.registries

  // passed to src/client/setProtocol.js, signifies client supports FML3/Forge
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
  client.removeListener('login_plugin_request', nmplistener)

  client.on('login_plugin_request', (data) => {
    if (data.channel === 'fml:loginwrapper') {
      // parse buffer
      const { data: loginwrapper } = proto.parsePacketBuffer(
        PROTODEF_TYPES.LOGINWRAPPER,
        data.data
      )

      if (!loginwrapper.channel) {
        console.error('Login wrapper missing channel:', loginwrapper)
        return
      }

      debug('Received login wrapper for channel:', loginwrapper.channel)

      switch (loginwrapper.channel) {
        case 'fml:handshake': {
          let handshake
          try {
            const parsed = proto.parsePacketBuffer(
              PROTODEF_TYPES.HANDSHAKE,
              loginwrapper.data
            )
            handshake = parsed.data
          } catch (error) {
            debug('Error parsing handshake packet:', error.message)
            debug('Raw data length:', loginwrapper.data.length)
            debug('Raw data hex:', loginwrapper.data.toString('hex'))
            
            // Send acknowledgment for unparseable packets
            const ackPacket = proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, { discriminator: 'Acknowledgement', data: {} })
            const loginWrapperPacket = proto.createPacketBuffer(PROTODEF_TYPES.LOGINWRAPPER, { channel: FML_CHANNELS.HANDSHAKE, data: ackPacket })
            client.write('login_plugin_response', { messageId: data.messageId, data: loginWrapperPacket })
            return
          }

          debug('Received handshake message:', handshake.discriminator)
          debug('Handshake data:', JSON.stringify(handshake.data, null, 2))

          let loginwrapperpacket = Buffer.alloc(0)
          switch (handshake.discriminator) {
            // First message: ModData - just acknowledge it
            case 'ModData': {
              debug('Received ModData from server:', handshake.data)
              
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

            // respond with ModListResponse
            case 'ModList': {
              const modlist = handshake.data
              debug('Received ModList from server:', modlist)

              const modlistreply = {
                modNames: modNames || modlist.modNames || [],
                channels: [],
                registries: []
              }

              if (!options.modNames) {
                modlistreply.modNames = modlist.modNames || []
              }

              if (!options.channels) {
                for (const { name, marker } of modlist.channels || []) {
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
                for (const { name } of modlist.registries || []) {
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

              debug('Sending ModListReply:', modlistreply)

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
              debug('Received ServerRegistry:', handshake.data)
              
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
              debug('Received ConfigurationData:', handshake.data.name)
              
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
            case 'ChannelMismatchData': {
              debug('Received ChannelMismatchData:', handshake.data)
              
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
              
            default:
              debug('Unknown handshake discriminator:', handshake.discriminator)
              debug('Unknown handshake data:', JSON.stringify(handshake.data, null, 2))
              
              // Send acknowledgment for unknown messages
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

          if (loginwrapperpacket.length > 0) {
            client.write('login_plugin_response', {
              messageId: data.messageId,
              data: loginwrapperpacket
            })
          }
          break
        }

        default:
          try {
            debug('Other loginwrapper channel received:', loginwrapper.channel, 'sending acknowledgement packet')
            const AcknowledgementPacket = proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, { discriminator: 'Acknowledgement', data: {} })
            const loginWrapperPacket = proto.createPacketBuffer(PROTODEF_TYPES.LOGINWRAPPER, { channel: FML_CHANNELS.HANDSHAKE, data: AcknowledgementPacket })
            client.write('login_plugin_response', { messageId: data.messageId, data: loginWrapperPacket })
            break
          } catch (error) {
            console.error('Error handling loginwrapper:', error)
          }
          break
      }
    } else {
      debug('Other channel received:', data.channel)
    }
  })
}
