const { ProtoDef } = require('protodef')
const proto = new ProtoDef(false)
proto.addTypes(require('./data/fabricRegistries.json').types)

module.exports = function decodeRegistries (bytes) {
  const parsed = proto.parsePacketBuffer('registrySync', bytes)
  if (parsed.metadata.size !== bytes.length) throw new Error('Trailing Fabric registry data')
  const registries = new Map()
  const identifier = (namespace, path) => {
    const name = `${namespace || 'minecraft'}:${path}`
    if (!/^[a-z0-9_.-]+:[a-z0-9/._-]+$/.test(name)) throw new Error('Invalid Fabric registry identifier')
    return name
  }
  for (const group of parsed.data) {
    for (const registry of group.registries) {
      const name = identifier(group.namespace, registry.path)
      if (registries.has(name)) throw new Error('Duplicate Fabric registry')
      if (registry.attributes & ~1) throw new Error('Unsupported Fabric registry attributes')
      const entries = new Map()
      const ids = new Set()
      let last = 0
      for (const namespace of registry.namespaces) {
        for (const bulk of namespace.bulks) {
          if (!bulk.paths.length) throw new Error('Empty Fabric registry ID bulk')
          let id = last + bulk.delta
          for (const path of bulk.paths) {
            const key = identifier(namespace.namespace, path)
            if (!Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff || ids.has(id) || entries.has(key)) throw new Error('Duplicate or invalid Fabric registry entry')
            entries.set(key, id)
            ids.add(id++)
          }
          last = id - 1
        }
      }
      registries.set(name, { optional: Boolean(registry.attributes & 1), entries })
    }
  }
  return registries
}
