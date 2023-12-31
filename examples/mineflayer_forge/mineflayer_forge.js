// Usage: node mineflayer_forge.js
// Change values of host, port, username before using. Tested with 1.19.2 Minecraft offline server.

const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const autoVersionForge = require('../../src/client/autoVersionForge')

const host = "server's IP"
const port = "server's port"
const username = "bot's username"

const bot = mineflayer.createBot({
  version: false,
  host,
  port,
  username
})

// leave options empty for guessing, otherwise specify the mods,
// channels and registries manually (channels and registries are only
// relevant for fml2 handshake)
const options = {
  forgeMods: undefined,
  channels: undefined
}

// add handler
autoVersionForge(bot._client, options)

bot.loadPlugin(pathfinder.pathfinder)
console.info('Started mineflayer')

// set up logging
bot.on('connect', function () {
  console.info('connected')
})

bot.on('spawn', function () {
  console.info('I spawned')
})
