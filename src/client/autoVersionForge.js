'use strict'

const forgeHandshake = require('./forgeHandshake')
const forgeHandshake2 = require('./forgeHandshake2')
const forgeHandshake3 = require('./forgeHandshake3')

module.exports = function (client, options) {
  if (!client.autoVersionHooks) client.autoVersionHooks = []

  client.autoVersionHooks.push(function (response, client, options) {
    if (!response.modinfo || response.modinfo.type !== 'FML') {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const forgeMods = response.modinfo.modList
    console.log('Using forgeMods:', forgeMods)

    // Install the FML|HS plugin with the given mods
    forgeHandshake(client, { forgeMods })
  })

  client.autoVersionHooks.push(function (response, client, options) {
    if (!response.forgeData || response.forgeData.fmlNetworkVersion !== 2) {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const forgeMods = response.forgeData.mods
    console.log('Using forgeMods:', forgeMods)

    // Install the FML2 plugin with the given mods
    forgeHandshake2(client, { forgeMods })
  })

  client.autoVersionHooks.push(function (response, client, options) {
    if (!response.forgeData || !response.forgeData.d) {
      return // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    const forgeMods = response.forgeData.mods
    console.log('Using forgeMods:', forgeMods)

    // Install the FML3 plugin with the given mods
    forgeHandshake3(client, { forgeMods })
  })
}
