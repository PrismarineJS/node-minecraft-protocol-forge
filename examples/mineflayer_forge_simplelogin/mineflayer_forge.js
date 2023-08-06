// Usage: node mineflayer_forge.js 
// Change values of host, port, username, sl_pwd before using. Tested with 1.19.2 Minecraft offline server with Simple Login mod.

var mineflayer = require('mineflayer');
var pathfinder = require('mineflayer-pathfinder');
var autoVersionForge = require('../../src/client/autoVersionForge');
var simplelogin = require('./simplelogin');

var host = "server's IP";
var port = "server's port";
var username = "bot's username";

var bot = mineflayer.createBot({
  version: false,
  host: host,
  port: port,
  username: username,
});

// leave options empty for guessing, otherwise specify the mods. Don't forget to write your Simple Login password (any password, if you connect for the first time)
const options = {
  forgeMods: undefined,
  channels: undefined,
  sl_pwd: "Simple Login password for your bot"
};

// add handler
autoVersionForge(bot._client, options);
simplelogin(bot._client,options);

bot.loadPlugin(pathfinder.pathfinder);
console.info('Started mineflayer');

// set up logging
bot.on('connect', function () {
  console.info('connected');
});

bot.on('spawn', function () {
    console.info('I spawned')
});
