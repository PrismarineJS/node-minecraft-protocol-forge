/* eslint-env mocha */
const assert = require('assert')
const { EventEmitter } = require('events')
const modern = require('../src/client/forgeHandshakeModern')

function string (value) {
  const data = Buffer.from(value)
  assert.ok(data.length < 128)
  return Buffer.concat([Buffer.from([data.length]), data])
}
function client (options) {
  const result = new EventEmitter()
  result.version = '1.20.2'
  result.state = 'configuration'
  result.writes = []
  result.errors = []
  result.write = (name, packet) => result.writes.push({ name, ...packet })
  result.on('error', error => result.errors.push(error.message))
  modern(result, options)
  result.receive = data => result.emit('custom_payload', { channel: 'forge:handshake', data })
  return result
}

describe('modern Forge configuration', () => {
  it('preserves explicit empty mod and channel lists', () => {
    const bot = client({ modVersions: [], channels: {} })
    bot.receive(Buffer.concat([Buffer.from([1, 1]), string('forge'), string('Forge'), string('48.1.0')]))
    bot.receive(Buffer.from([2, 0]))
    assert.deepStrictEqual(bot.writes.map(packet => packet.data), [Buffer.from([1, 0]), Buffer.from([2, 0])])
  })

  it('rejects truncated and trailing data without a success response', () => {
    for (const bytes of [[1], [2, 0, 1]]) {
      const bot = client()
      bot.receive(Buffer.from(bytes))
      assert.equal(bot.errors.length, 1)
      assert.equal(bot.writes.length, 0)
      bot.receive(Buffer.from([1, 0]))
      assert.equal(bot.writes.length, 0)
    }
  })

  it('does not process handshake packets outside configuration', () => {
    const bot = client()
    bot.state = 'play'
    bot.receive(Buffer.from([1, 0]))
    assert.equal(bot.writes.length, 0)
    assert.deepStrictEqual(bot.errors, [])
  })

  it('rejects duplicate registry lists and duplicate names', () => {
    const bot = client()
    bot.receive(Buffer.from([3, 7, 0, 0]))
    bot.receive(Buffer.from([3, 8, 0, 0]))
    assert.equal(bot.writes.length, 1)
    assert.match(bot.errors[0], /Duplicate modern Forge registry list/)
    const other = client()
    other.receive(Buffer.concat([Buffer.from([3, 7, 2]), string('example:test'), string('example:test'), Buffer.from([0])]))
    assert.equal(other.writes.length, 0)
    assert.match(other.errors[0], /Duplicate modern Forge registry name/)
  })

  it('answers the captured mod-list request and advertises only configured channels', () => {
    const bot = client()
    const mods = Buffer.from('0102096d696e656372616674094d696e65637261667406312e32302e3205666f72676505466f7267650634382e312e30', 'hex')
    bot.receive(mods)
    assert.deepStrictEqual(bot.writes[0].data, mods)
    bot.receive(Buffer.from([2, 0]))
    assert.deepStrictEqual(bot.writes[1].data, Buffer.concat([
      Buffer.from([2, 2]), string('forge:handshake'), Buffer.from([0]), string('forge:login'), Buffer.from([0])
    ]))
    assert.deepStrictEqual(bot.errors, [])
  })

  it('acknowledges the matching registry tokens and waits for all registries', () => {
    const bot = client()
    bot.receive(Buffer.from([1, 0]))
    bot.receive(Buffer.from([2, 0]))
    bot.receive(Buffer.concat([Buffer.from([3, 7, 1]), string('example:test'), Buffer.from([0])]))
    assert.deepStrictEqual(bot.writes.at(-1).data, Buffer.from([0, 7]))
    bot.receive(Buffer.concat([Buffer.from([4, 8]), string('example:test'), Buffer.from([0, 0, 0, 0])]))
    assert.deepStrictEqual(bot.writes.at(-1).data, Buffer.from([0, 8]))
    assert.deepStrictEqual(bot.forgeRegistries.get('example:test'), [])
    bot.state = 'play'
    bot.emit('state', 'play')
    assert.equal(bot.forgeHandshakeComplete, true)
    assert.deepStrictEqual(bot.errors, [])
    bot.state = 'configuration'
    bot.emit('state', 'configuration')
    assert.equal(bot.forgeHandshakeComplete, false)
    assert.equal(bot.forgeRegistries.size, 0)
    bot.receive(Buffer.from([1, 0]))
    bot.receive(Buffer.from([2, 0]))
    bot.receive(Buffer.from([3, 9, 0, 0]))
    bot.state = 'play'
    bot.emit('state', 'play')
    assert.equal(bot.forgeHandshakeComplete, true)
    assert.deepStrictEqual(bot.errors, [])
  })

  it('emits config contents without an unsolicited acknowledgment', () => {
    const bot = client()
    let config
    bot.once('forgeConfig', (name, data) => { config = { name, data } })
    bot.receive(Buffer.concat([Buffer.from([5]), string('example.toml'), Buffer.from([2, 1, 2])]))
    assert.deepStrictEqual(config, { name: 'example.toml', data: Buffer.from([1, 2]) })
    assert.equal(bot.writes.length, 0)
  })

  it('does not acknowledge unannounced registries or unsupported datapacks', () => {
    const bot = client()
    bot.receive(Buffer.concat([Buffer.from([4, 8]), string('example:test'), Buffer.from([0, 0, 0, 0])]))
    const other = client()
    other.receive(Buffer.concat([Buffer.from([3, 7, 0, 1]), string('example:required')]))
    assert.equal(bot.writes.length, 0)
    assert.equal(other.writes.length, 0)
    assert.match(bot.errors[0], /Unexpected modern Forge registry/)
    assert.match(other.errors[0], /Unsupported modern Forge data-pack registry/)
  })

  it('does not report completion when entering play before configuration', () => {
    const bot = client()
    bot.state = 'play'
    bot.emit('state', 'play')
    assert.equal(bot.forgeHandshakeComplete, false)
    assert.match(bot.errors[0], /before completing configuration/)
  })

  it('reports the server channel-mismatch message without acknowledging it', () => {
    const bot = client()
    let code
    bot.once('error', error => { code = error.code })
    bot.receive(Buffer.from([6, 0, 0, 0, 0]))
    assert.equal(code, 'FORGE_CHANNEL_MISMATCH')
    bot.receive(Buffer.from([1, 0]))
    bot.state = 'play'
    bot.emit('state', 'play')
    assert.equal(bot.forgeHandshakeComplete, false)
    assert.equal(bot.writes.length, 0)
  })
})
