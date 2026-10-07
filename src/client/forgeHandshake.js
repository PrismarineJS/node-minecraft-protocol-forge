const ProtoDef = require('protodef').ProtoDef
const assert = require('assert')
const debug = require('../../debug')

const proto = new ProtoDef()
// RegistryData currently decodes only its sequencing prefix, not FML1 mappings.
proto.addTypes(require('./data/fml1.json').types)

function writeAck (client, phase) {
  const ackData = proto.createPacketBuffer('FML|HS', {
    discriminator: 'HandshakeAck', // HandshakeAck,
    phase
  })
  client.write('custom_payload', {
    channel: 'FML|HS',
    data: ackData
  })
}

const FMLHandshakeClientState = {
  START: 1,
  WAITINGSERVERDATA: 2,
  WAITINGSERVERCOMPLETE: 3,
  PENDINGCOMPLETE: 4,
  COMPLETE: 5,
  RESET: 6
}

function fmlHandshakeStep (client, data, options) {
  const parsed = proto.parsePacketBuffer('FML|HS', data)
  debug('FML|HS', parsed)

  const fmlHandshakeState = parsed.data.discriminator === 'HandshakeReset'
    ? FMLHandshakeClientState.RESET
    : (client.fmlHandshakeState || FMLHandshakeClientState.START)

  switch (fmlHandshakeState) {
    case FMLHandshakeClientState.START: {
      assert.ok(
        parsed.data.discriminator === 'ServerHello',
        `expected ServerHello in START state, got ${parsed.data.discriminator}`
      )
      if (parsed.data.fmlProtocolVersion > 2) {
        // TODO: support higher protocols, if they change
      }

      client.write('custom_payload', {
        channel: 'REGISTER',
        data: Buffer.from(
          ['FML|HS', 'FML', 'FML|MP', 'FML', 'FORGE'].join('\0')
        )
      })

      const clientHello = proto.createPacketBuffer('FML|HS', {
        discriminator: 'ClientHello',
        fmlProtocolVersion: parsed.data.fmlProtocolVersion
      })

      client.write('custom_payload', {
        channel: 'FML|HS',
        data: clientHello
      })

      debug('Sending client modlist')
      const modList = proto.createPacketBuffer('FML|HS', {
        discriminator: 'ModList',
        mods: options.forgeMods || []
      })
      client.write('custom_payload', {
        channel: 'FML|HS',
        data: modList
      })
      writeAck(client, FMLHandshakeClientState.WAITINGSERVERDATA)
      client.fmlHandshakeState = FMLHandshakeClientState.WAITINGSERVERDATA
      break
    }

    case FMLHandshakeClientState.WAITINGSERVERDATA: {
      assert.ok(
        parsed.data.discriminator === 'ModList',
        `expected ModList in WAITINGSERVERDATA state, got ${parsed.data.discriminator}`
      )
      debug('Server ModList:', parsed.data.mods)
      // Emit event so client can check client/server mod compatibility
      client.emit('forgeMods', parsed.data.mods)

      client.fmlHandshakeState = FMLHandshakeClientState.WAITINGSERVERCOMPLETE
      break
    }

    case FMLHandshakeClientState.WAITINGSERVERCOMPLETE: {
      assert.ok(
        parsed.data.discriminator === 'RegistryData',
        `expected RegistryData in WAITINGSERVERCOMPLETE, got ${parsed.data.discriminator}`
      )
      debug('RegistryData', parsed.data)
      if (
        client.version === '1.7.10' || // actually ModIdData packet, and there is only one of those TODO: avoid hardcoding version, allow earlier
        parsed.data.hasMore === false
      ) {
        // RegistryData packet 1.8+ hasMore boolean field, set to false when ready to ack
        debug('LAST RegistryData')

        writeAck(client, FMLHandshakeClientState.WAITINGSERVERCOMPLETE)
        client.fmlHandshakeState = FMLHandshakeClientState.PENDINGCOMPLETE
      }
      break
    }

    case FMLHandshakeClientState.PENDINGCOMPLETE: {
      assert.ok(
        parsed.data.discriminator === 'HandshakeAck',
        `expected HandshakeAck in PENDINGCOMPLETE, got ${parsed.data.discrimnator}`
      )
      assert.ok(
        parsed.data.phase === 2,
        `expected HandshakeAck phase WAITINGACK, got ${parsed.data.phase}`
      )
      writeAck(client, FMLHandshakeClientState.PENDINGCOMPLETE)
      client.fmlHandshakeState = FMLHandshakeClientState.COMPLETE
      break
    }

    case FMLHandshakeClientState.COMPLETE: {
      assert.ok(
        parsed.data.phase === 3,
        `expected HandshakeAck phase COMPLETE, got ${parsed.data.phase}`
      )

      writeAck(client, FMLHandshakeClientState.COMPLETE)
      debug('HandshakeAck Complete!')
      break
    }

    case FMLHandshakeClientState.RESET: {
      assert.ok(
        parsed.data.discriminator === 'HandshakeReset',
        `expected HandshakeReset in RESET state, got ${parsed.data.discriminator}`
      )

      client.fmlHandshakeState = FMLHandshakeClientState.START
      debug('HandshakeReset!')
      break
    }

    default:
      console.error(`unexpected FML state ${fmlHandshakeState}`)
  }
}

module.exports = function (client, options) {
  client.tagHost = '\0FML\0' // passed to src/client/setProtocol.js, signifies client supports FML/Forge
  client.on('custom_payload', function (packet) {
    // TODO: channel registration tracking in NMP, https://github.com/PrismarineJS/node-minecraft-protocol/pull/328
    if (packet.channel === 'FML|HS') {
      fmlHandshakeStep(client, packet.data, options)
    }
  })
}
