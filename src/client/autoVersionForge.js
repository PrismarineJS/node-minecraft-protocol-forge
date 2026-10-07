'use strict'

const forgeHandshake = require('./forgeHandshake')
const forgeHandshake2 = require('./forgeHandshake2')
const forgeHandshake3 = require('./forgeHandshake3')
const forgeHandshakeModern = require('./forgeHandshakeModern')

module.exports = function (client, forgeOptions = {}) {
  if (!client.autoVersionHooks) client.autoVersionHooks = []

  client.autoVersionHooks.push(function (response, client) {
    if (!response.modinfo || response.modinfo.type !== 'FML') {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const forgeMods = response.modinfo.modList
    console.log('Using forgeMods:', forgeMods)

    // Install the FML|HS plugin with the given mods
    forgeHandshake(client, { ...forgeOptions, forgeMods: forgeOptions.forgeMods ?? forgeMods })
  })

  client.autoVersionHooks.push(function (response, client) {
    if (!response.forgeData || response.forgeData.fmlNetworkVersion !== 2) {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const forgeMods = response.forgeData.mods?.map(mod => mod.modId)
    console.log('Using forgeMods:', forgeMods)

    // Install the FML2 plugin with the given mods
    forgeHandshake2(client, { ...forgeOptions, forgeMods: forgeOptions.forgeMods ?? forgeMods })
  })

  client.autoVersionHooks.push(function (response, client) {
    if (!response.forgeData || response.forgeData.fmlNetworkVersion !== 3) {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const advertisedMods = response.forgeData.mods
    const forgeMods = forgeOptions.forgeMods ?? (advertisedMods?.length ? advertisedMods.map(mod => typeof mod === 'string' ? mod : mod.modId) : undefined)
    console.log('Using forgeMods:', forgeMods || 'server handshake list')

    // Install the FML3 plugin with the given mods
    forgeHandshake3(client, { ...forgeOptions, forgeMods })
  })

  client.autoVersionHooks.push(function (response, client) {
    if (response.forgeData?.fmlNetworkVersion !== 0) return
    forgeHandshakeModern(client, forgeOptions)
  })
}
