const { ProtoDef } = require('protodef')
const minecraftData = require('minecraft-data')
const installedNodes = new WeakMap()

const proto = new ProtoDef(false)
proto.addType('string', ['pstring', { countType: 'varint' }])
const snapshot = require('./data/fml3.json').types.forge_snapshot
proto.addType('snapshot', ['container', snapshot[1].filter(field => field.name !== 'dummied')])
proto.addType('dummied', ['array', { countType: 'varint', type: 'string' }])

function readRegistry (buffer) {
  const parsed = proto.parsePacketBuffer('snapshot', buffer)
  let size = parsed.metadata.size
  // Older snapshots have a final dummied collection; newer ones omit it.
  if (size < buffer.length) size += proto.read(buffer, size, 'dummied').size
  if (size !== buffer.length) throw new Error('Unexpected trailing Forge registry data')
  return parsed.data.ids
}

function installCommandRegistry (client, buffer) {
  return installCommandRegistryEntries(client, buffer && readRegistry(buffer))
}

function installCommandRegistryEntries (client, entries) {
  const data = minecraftData(client.version)
  const node = JSON.parse(JSON.stringify(data.protocol.types.command_node))
  const fields = node[1].find(field => field.name === 'extraNodeData').type[1].fields[2][1]
  const parser = fields.find(field => field.name === 'parser')
  // String-based versions need the Forge properties at initialization; numeric
  // versions must wait for the server's ID registry before installing a schema.
  const numeric = parser.type[0] === 'mapper'
  if (parser.type !== 'string' && !numeric) throw new Error('Unsupported command argument schema')
  if ((numeric && !entries) || (!numeric && entries)) return

  const properties = fields.find(field => field.name === 'properties').type[1].fields
  const knownNames = new Set(numeric ? Object.values(parser.type[1].mappings) : Object.keys(properties))
  const forgeProperties = {
    'forge:enum': 'string',
    'forge:modid': 'void',
    'neoforge:enum': 'string',
    'neoforge:modid': 'void',
    // minecraft-data calls this vanilla argument minecraft:nbt.
    'minecraft:nbt_compound_tag': properties['minecraft:nbt'],
    'minecraft:test_argument': 'void',
    'minecraft:test_class': 'void'
  }
  const mappings = {}
  const names = new Set()
  for (const { key, value } of numeric ? entries : []) {
    if (!Number.isInteger(value) || value < 0 || Object.hasOwn(mappings, value) || names.has(key)) {
      throw new Error('Duplicate or invalid Forge command argument registry entry')
    }
    if (!knownNames.has(key) && !Object.hasOwn(forgeProperties, key)) {
      throw new Error(`Unsupported Forge command argument type: ${key}`)
    }
    mappings[value] = key
    names.add(key)
  }
  if (numeric) parser.type[1].mappings = mappings
  Object.assign(properties, forgeProperties)

  // This requires minecraft-protocol's isolated customPackets compilation.
  // Never mutate the shared minecraft-data schema or a compiled protocol cache.
  const version = data.version.majorVersion
  const existing = client.customPackets?.[version]
  const ownsExisting = existing?.types?.command_node === 'forge_command_node' && existing?.types?.forge_command_node === installedNodes.get(client)
  if (!ownsExisting && (existing?.types?.command_node || existing?.types?.forge_command_node)) {
    throw new Error('A custom command_node schema is already installed')
  }
  client.customPackets = {
    ...client.customPackets,
    [version]: {
      ...existing,
      types: { ...existing?.types, command_node: 'forge_command_node', forge_command_node: node }
    }
  }
  installedNodes.set(client, node)
}

module.exports = { readRegistry, installCommandRegistry, installCommandRegistryEntries }
