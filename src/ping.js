const Buffer = require('buffer').Buffer
const ProtoDef = require('protodef').ProtoDef
const mc = require('minecraft-protocol')
const debug = require('debug')('minecraft-protocol-forge')

module.exports = ping

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

proto.addTypes({
  resource_location: ['string'],
  mod: [
    function (buffer, offset, typeArgs, context) {
      let newOffset = offset

      const channelSizeAndVersionFlagResult = this.read(buffer, newOffset, 'varint', {}, context)
      newOffset += channelSizeAndVersionFlagResult.size
      const hasModVersion = (channelSizeAndVersionFlagResult.value & 0b1) === 0
      const channelSize = channelSizeAndVersionFlagResult.value >>> 1

      const modIdResult = this.read(buffer, newOffset, 'string', {}, context)
      newOffset += modIdResult.size
      const modId = modIdResult.value

      let modVersion
      if (hasModVersion) {
        const modVersionResult = this.read(buffer, newOffset, 'string', {}, context)
        newOffset += modVersionResult.size
        modVersion = modVersionResult.value
      }

      const channels = []
      for (let i = 0; i < channelSize; i++) {
        const channelResult = this.read(buffer, newOffset, 'mod_channel', {}, context)
        newOffset += channelResult.size
        channels.push(channelResult.value)
      }
      return {
        value: {
          modId,
          modVersion,
          channels
        },
        size: newOffset - offset
      }
    },
    function (value, buffer, offset, typeArgs, context) {
      const channelSizeAndVersionFlag = (value.channels.length << 1) | (value.modVersion ? 0 : 1)
      offset = this.write(channelSizeAndVersionFlag, buffer, offset, 'varint', {}, context)

      offset = this.write(value.modId, buffer, offset, 'string', {}, context)

      if (value.modVersion) {
        offset = this.write(value.modVersion, buffer, offset, 'string', {}, context)
      }

      for (const channel of (value.channels || [])) {
        offset = this.write(channel, buffer, offset, 'mod_channel', {}, context)
      }

      return offset
    },
    function (value, typeArgs, context) {
      let size = 0
      const channelSizeAndVersionFlag = (value.channels.length << 1) | (value.modVersion ? 0 : 1)
      size += this.sizeOf(channelSizeAndVersionFlag, 'varint', {}, context)
      size += this.sizeOf(value.modId, 'string', {}, context)
      if (value.modVersion) {
        size += this.sizeOf(value.modVersion, 'string', {}, context)
      }
      for (const channel of (value.channels || [])) {
        size += this.sizeOf(channel, 'mod_channel', {}, context)
      }
      return size
    }
  ],
  mod_channel: [
    'container',
    [
      { name: 'channelName', type: 'string' },
      { name: 'channelVersion', type: 'string' },
      { name: 'requiredOnClient', type: 'bool' }
    ]
  ],
  non_mod_channel: [
    'container',
    [
      { name: 'channelName', type: 'resource_location' },
      { name: 'channelVersion', type: 'string' },
      { name: 'requiredOnClient', type: 'bool' }
    ]
  ],
  forge_d: [
    'container',
    [
      { name: 'truncated', type: 'bool' },
      { name: 'modsSize', type: 'u16' },
      { name: 'mods', type: ['array', { count: 'modsSize', type: 'mod' }] },
      { name: 'nonModChannelCount', type: 'varint' },
      { name: 'nonModChannels', type: ['array', { count: 'nonModChannelCount', type: 'non_mod_channel' }] }
    ]
  ]
})

function ping (options, cb) {
  return mc.ping(options).then((data) => {
    if (options?.deserializeForgeData !== false && data.forgeData?.d) {
      try {
        const buf = decodeOptimized(data.forgeData.d)
        const d = proto.parsePacketBuffer('forge_d', buf).data
        if (options?.overrideForgeData !== false) {
          data.forgeData.mods = d.mods.map((mod) => ({
            modId: mod.modId,
            modVersion: mod.modVersion
          }))
          const modsChannels = d.mods.flatMap((mod) => mod.channels.map((ch) => ({
            channelName: `${mod.modId}:${ch.channelName}`,
            channelVersion: ch.channelVersion,
            requiredOnClient: ch.requiredOnClient
          })))
          data.forgeData.channels = modsChannels.concat(d.nonModChannels)
          delete data.forgeData.d
        } else {
          data.forgeData.d = d
        }
      } catch (e) {
        debug('Failed to deserialize forgeData', e)
      }
    }
    return data
  })
}

/**
 * @param {string} s
 * @returns {Buffer}
 */
function decodeOptimized (s) {
  const size0 = s.charCodeAt(0)
  const size1 = s.charCodeAt(1)
  const size = size0 | (size1 << 15)

  const buf = Buffer.alloc(size)

  let stringIndex = 2
  let buffer = 0
  let bitsInBuf = 0
  let bufOffset = 0

  while (stringIndex < s.length) {
    while (bitsInBuf >= 8 && bufOffset < size) {
      buf[bufOffset++] = buffer & 0xff
      buffer >>>= 8
      bitsInBuf -= 8
    }
    const c = s.charCodeAt(stringIndex)
    buffer |= (c & 0x7fff) << bitsInBuf
    bitsInBuf += 15
    stringIndex++
  }

  // write any leftovers
  while (bufOffset < size) {
    buf[bufOffset++] = buffer & 0xff
    buffer >>>= 8
    bitsInBuf -= 8
  }
  return buf
}
