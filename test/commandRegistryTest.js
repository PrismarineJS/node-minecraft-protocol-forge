/* eslint-env mocha */
const assert = require('assert')
const { ProtoDef } = require('protodef')
const minecraftData = require('minecraft-data')
const { createDeserializer } = require('minecraft-protocol')
const { readRegistry, installCommandRegistry } = require('../src/client/commandRegistry')
const fixture = require('./fixtures/forge-1.20.1-commands.json')

const snapshot = Buffer.from(fixture.snapshot, 'hex')
const packet = Buffer.from(fixture.commands, 'hex')
const options = { version: fixture.version, state: 'play', isServer: false }
function protocol (client) {
  return createDeserializer({ ...options, customPackets: client.customPackets }).proto
}

function encodeRegistry (ids) {
  const encoder = new ProtoDef(false)
  encoder.addType('string', ['pstring', { countType: 'varint' }])
  encoder.addType('snapshot', ['container', require('../src/client/data/fml3.json').types.forge_snapshot[1].slice(0, 4)])
  return encoder.createPacketBuffer('snapshot', { ids, aliases: [], overrides: [], blocked: [] })
}

describe('Forge command registries', () => {
  it('reads old and new snapshot tails without discarding unknown trailing bytes', () => {
    assert.deepStrictEqual(readRegistry(Buffer.concat([snapshot, Buffer.from([0])])), readRegistry(snapshot))
    assert.throws(() => readRegistry(Buffer.concat([snapshot, Buffer.from([0, 1])])), /trailing/)
    assert.throws(() => readRegistry(snapshot.subarray(0, snapshot.length - 1)))
  })

  it('parses the complete captured packet without changing shared data', () => {
    const shared = JSON.stringify(minecraftData(fixture.version).protocol)
    createDeserializer(options) // warm the vanilla cache first
    const client = { version: fixture.version }
    installCommandRegistry(client, snapshot)
    const parsed = protocol(client).parsePacketBuffer('packet', packet)
    assert.equal(parsed.metadata.size, packet.length)
    assert.equal(parsed.data.params.rootIndex, 0)
    assert.equal(parsed.data.params.nodes.length, 33)
    assert.equal(JSON.stringify(minecraftData(fixture.version).protocol), shared)
  })

  it('isolates two clients whose server registries assign different numeric IDs', () => {
    const encoder = new ProtoDef(false)
    encoder.addType('string', ['pstring', { countType: 'varint' }])
    encoder.addType('snapshot', ['container', require('../src/client/data/fml3.json').types.forge_snapshot[1].slice(0, 4)])
    const shifted = encoder.createPacketBuffer('snapshot', {
      ids: readRegistry(snapshot).map(entry => ({ key: entry.key, value: entry.value + 100 })),
      aliases: [],
      overrides: [],
      blocked: []
    })
    const first = { version: fixture.version }
    const second = { version: fixture.version }
    installCommandRegistry(first, snapshot)
    installCommandRegistry(second, shifted)
    const a = protocol(first)
    const b = protocol(second)
    const original = a.parsePacketBuffer('packet', packet).data
    const encoded = b.createPacketBuffer('packet', original)
    assert.notDeepStrictEqual(encoded, packet)
    assert.deepStrictEqual(b.parsePacketBuffer('packet', encoded).data, original)
    assert.deepStrictEqual(a.parsePacketBuffer('packet', packet).data, original)
    installCommandRegistry(first, shifted)
    const replacement = protocol(first)
    assert.deepStrictEqual(replacement.parsePacketBuffer('packet', encoded).data, original)
    assert.deepStrictEqual(a.parsePacketBuffer('packet', packet).data, original)
  })

  it('does not replace an existing caller-supplied command schema', () => {
    const client = { version: fixture.version, customPackets: { '1.20': { types: { command_node: 'void' } } } }
    const original = client.customPackets
    assert.throws(() => installCommandRegistry(client, snapshot), /already installed/)
    assert.strictEqual(client.customPackets, original)
  })

  it('leaves pre-numeric argument protocols unchanged', () => {
    const client = { version: '1.18.2' }
    installCommandRegistry(client, snapshot)
    assert.equal(client.customPackets, undefined)
  })

  for (const version of ['1.13.2', '1.16.5', '1.17.1', '1.18.2']) {
    it(`installs Forge properties without changing the string parser on ${version}`, () => {
      const client = { version }
      installCommandRegistry(client)
      const node = client.customPackets[minecraftData(version).version.majorVersion].types.forge_command_node
      const fields = node[1].find(field => field.name === 'extraNodeData').type[1].fields[2][1]
      assert.equal(fields.find(field => field.name === 'parser').type, 'string')
      assert.equal(fields.find(field => field.name === 'properties').type[1].fields['forge:enum'], 'string')
      const proto = createDeserializer({ version, state: 'play', customPackets: client.customPackets }).proto
      const flags = { unused: 0, has_custom_suggestions: 0, has_redirect_node: 0, has_command: 0, command_node_type: 0 }
      const encoded = proto.createPacketBuffer('packet', {
        name: 'declare_commands',
        params: {
          rootIndex: 0,
          nodes: [
            { flags, children: [1] },
            { flags: { ...flags, has_command: 1, command_node_type: 2 }, children: [], extraNodeData: { name: 'test', parser: 'forge:enum', properties: 'example.Enum' } }
          ]
        }
      })
      const parsed = proto.parsePacketBuffer('packet', encoded)
      assert.equal(parsed.metadata.size, encoded.length)
      assert.equal(parsed.data.params.nodes[1].extraNodeData.properties, 'example.Enum')
    })
  }

  it('rejects duplicate registry IDs and unsupported argument types without installing a partial schema', () => {
    const client = { version: fixture.version }
    assert.throws(() => installCommandRegistry(client, encodeRegistry([
      { key: 'forge:enum', value: 0 }, { key: 'forge:modid', value: 0 }
    ])), /Duplicate or invalid/)
    assert.throws(() => installCommandRegistry(client, encodeRegistry([
      { key: 'example:unknown', value: 0 }
    ])), /Unsupported Forge command argument type/)
    assert.equal(client.customPackets, undefined)
  })
})
