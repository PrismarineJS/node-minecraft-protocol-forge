// Usage: node mineflayer_forge.js
// Change values of host, port, username, sl_pwd before using. Tested with 1.19.2 Minecraft offline server with Simple Login mod.

const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const autoVersionForge = require('../../src/client/autoVersionForge')
const simplelogin = require('./simplelogin')

const host = "server's IP"
const port = "server's port"
const username = "bot's username"

const bot = mineflayer.createBot({
  version: false,
  host,
  port,
  username
})

// leave options empty for guessing, otherwise specify the mods. Don't forget to write your Simple Login password (any password, if you connect for the first time)
const options = {
  forgeMods: undefined,
  channels: undefined,
  sl_pwd: 'Simple Login password for your bot'
}

// add handler
autoVersionForge(bot._client, options)
simplelogin(bot._client, options)

bot.loadPlugin(pathfinder.pathfinder)
console.info('Started mineflayer')

// set up logging
bot.on('connect', function () {
  console.info('connected')
})

bot.on('spawn', function () {
  console.info('I spawned')
})
