const { ProtoDef } = require('protodef')
const proto = new ProtoDef(false)
proto.addTypes(require('./data/neoforgeChecks.json').types)

module.exports = function (client) {
  const sendAck = name => client.write('custom_payload', { channel: `neoforge:${name}`, data: Buffer.alloc(0) })
  const decode = (type, bytes) => {
    const result = proto.parsePacketBuffer(type, bytes)
    if (result.metadata.size !== bytes.length) throw new Error('Trailing NeoForge compatibility data')
    return result.data
  }
  return {
    'neoforge:extensible_enum_data': {
      version: '1',
      flow: 'clientbound',
      optional: true,
      handler: bytes => {
        const entries = decode('enums', bytes)
        if (entries.some(entry => entry.extension || !['CLIENTBOUND', 'SERVERBOUND', 'BIDIRECTIONAL'].includes(entry.direction))) {
          throw new Error('Unsupported NeoForge enum extensions')
        }
        client.emit('neoforgeEnums', entries)
        sendAck('extensible_enum_ack')
      }
    },
    'neoforge:extensible_enum_ack': { version: '1', flow: 'serverbound', optional: true },
    'neoforge:feature_flags': {
      version: '1',
      flow: 'clientbound',
      optional: true,
      handler: bytes => {
        const flags = decode('flags', bytes)
        if (flags.length) throw new Error('Unsupported NeoForge modded feature flags')
        client.emit('neoforgeFeatureFlags', flags)
        sendAck('feature_flags_ack')
      }
    },
    'neoforge:feature_flags_ack': { version: '1', flow: 'serverbound', optional: true }
  }
}
