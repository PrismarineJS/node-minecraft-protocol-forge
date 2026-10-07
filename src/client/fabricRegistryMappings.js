const minecraftData = require('minecraft-data')

const installed = new WeakMap()
const versionMappings = require('./data/fabricRegistryMappings.json')
const supported = new Set([
  'minecraft:data_component_type',
  'minecraft:particle_type',
  'minecraft:sound_event'
])

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function registrySchema (data, registryName, registry, typeName, codecTable, aliases) {
  const type = clone(data.protocol.types[typeName])
  const mapper = typeName === 'Particle'
    ? type[1].find(field => field.name === 'type').type[1].mappings
    : type[1].mappings
  const vanillaNames = new Set(Object.values(mapper))
  const liveNames = new Set(registry.entries.keys())
  const mappings = {}
  const codecs = {}

  for (const [name, id] of registry.entries) {
    const separator = name.indexOf(':')
    const namespace = name.slice(0, separator)
    const path = name.slice(separator + 1)
    const wireName = namespace === 'minecraft' ? (aliases[name] || path) : name
    if (namespace === 'minecraft') {
      if (!vanillaNames.has(wireName)) throw new Error(`Unsupported vanilla ${registryName} entry: ${name}`)
    } else {
      if (!Object.hasOwn(codecTable, name)) throw new Error(`Missing ${registryName} codec: ${name}`)
      codecs[wireName] = clone(codecTable[name])
    }
    if (Object.hasOwn(mappings, id)) throw new Error(`Duplicate ${registryName} ID: ${id}`)
    mappings[id] = wireName
  }

  for (const vanilla of vanillaNames) {
    const original = Object.entries(aliases).find(([, mapped]) => mapped === vanilla)?.[0] || `minecraft:${vanilla}`
    if (!liveNames.has(original)) {
      throw new Error(`Missing vanilla ${registryName} entry: ${original}`)
    }
  }
  if (typeName === 'Particle') {
    type[1].find(field => field.name === 'type').type[1].mappings = mappings
    Object.assign(type[1].find(field => field.name === 'data').type[1].fields, codecs)
  } else {
    type[1].mappings = mappings
  }
  return { type, codecs }
}

function installFabricRegistryMappings (client, registries, options = {}) {
  if (client.version !== '1.21.11') throw new Error('Fabric registry mappings are only verified for 1.21.11')
  if (!(registries instanceof Map)) throw new TypeError('Fabric registries must be a Map')
  for (const name of registries.keys()) {
    if (!supported.has(name)) throw new Error(`Unsupported Fabric registry: ${name}`)
  }
  for (const [name, registry] of registries) {
    if (!(registry.entries instanceof Map)) throw new TypeError(`Invalid Fabric registry entries: ${name}`)
  }

  const data = minecraftData(client.version)
  const mappings = versionMappings[client.version]
  const particleName = 'minecraft:particle_type'
  const componentName = 'minecraft:data_component_type'
  const particle = registries.has(particleName)
    ? registrySchema(data, particleName, registries.get(particleName), 'Particle', options.particleTypes || {}, mappings[particleName]?.aliases || {})
    : null
  const componentType = registries.has(componentName)
    ? registrySchema(data, componentName, registries.get(componentName), 'SlotComponentType', options.dataComponentTypes || {}, mappings[componentName]?.aliases || {})
    : null
  let component
  if (componentType) {
    component = clone(data.protocol.types.SlotComponent)
    const componentFields = component[1].find(field => field.name === 'data').type[1].fields
    Object.assign(componentFields, componentType.codecs)
    component[1].find(field => field.name === 'type').type = 'fabric_SlotComponentType'
  }
  const version = data.version.majorVersion
  const existing = client.customPackets?.[version]
  const previous = installed.get(client)
  const ownedEntries = previous
    ? {
        Particle: 'fabric_Particle',
        fabric_Particle: previous.particle,
        SlotComponentType: 'fabric_SlotComponentType',
        fabric_SlotComponentType: previous.componentType,
        SlotComponent: 'fabric_SlotComponent',
        fabric_SlotComponent: previous.component
      }
    : {}
  const names = particle ? ['Particle', 'fabric_Particle'] : []
  if (componentType) names.push('SlotComponentType', 'fabric_SlotComponentType', 'SlotComponent', 'fabric_SlotComponent')
  for (const name of names) {
    if (existing?.types?.[name] !== undefined && existing.types[name] !== ownedEntries[name]) throw new Error(`A custom ${name} schema is already installed`)
  }

  const types = { ...existing?.types }
  for (const [name, value] of Object.entries(ownedEntries)) {
    if (types[name] === value) delete types[name]
  }
  const owned = {
    particle: particle?.type,
    componentType: componentType?.type,
    component
  }
  if (particle) Object.assign(types, { Particle: 'fabric_Particle', fabric_Particle: owned.particle })
  if (componentType) {
    Object.assign(types, {
      SlotComponentType: 'fabric_SlotComponentType',
      fabric_SlotComponentType: owned.componentType,
      SlotComponent: 'fabric_SlotComponent',
      fabric_SlotComponent: owned.component
    })
  }
  client.customPackets = {
    ...client.customPackets,
    [version]: {
      ...existing,
      types
    }
  }
  installed.set(client, owned)
  client.fabricRegistries = registries
  return true
}

// Remove the registry schemas and mappings this helper installed for a client, without touching caller-owned custom
// schemas. Called when a connection re-enters configuration: a backend that sends no registry sync (Fabric skips it when
// there is nothing to remap) must not inherit the previous backend's mappings, or its vanilla ids decode with stale ones.
function resetFabricRegistryMappings (client) {
  const previous = installed.get(client)
  if (!previous) {
    if (client.fabricRegistries) delete client.fabricRegistries
    return false
  }
  const ownedEntries = {
    Particle: 'fabric_Particle',
    fabric_Particle: previous.particle,
    SlotComponentType: 'fabric_SlotComponentType',
    fabric_SlotComponentType: previous.componentType,
    SlotComponent: 'fabric_SlotComponent',
    fabric_SlotComponent: previous.component
  }
  const version = minecraftData(client.version).version.majorVersion
  const existing = client.customPackets?.[version]
  if (existing?.types) {
    const types = { ...existing.types }
    for (const [name, value] of Object.entries(ownedEntries)) {
      if (types[name] === value) delete types[name] // only our schemas; a caller-owned entry has a different value
    }
    client.customPackets = { ...client.customPackets, [version]: { ...existing, types } }
  }
  installed.delete(client)
  delete client.fabricRegistries
  return true
}

module.exports = installFabricRegistryMappings
module.exports.reset = resetFabricRegistryMappings
