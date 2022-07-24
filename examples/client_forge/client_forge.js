var mc = require('minecraft-protocol');
var autoVersionForge = require('../../src/client/autoVersionForge');

if (process.argv.length < 4 || process.argv.length > 6) {
  console.log("Usage : node echo.js <host> <port> [<name>] [<password>]");
  process.exit(1);
}

var host = process.argv[2];
var port = parseInt(process.argv[3]);
var username = process.argv[4] ? process.argv[4] : "echo";
var password = process.argv[5];

var client = mc.createClient({
  version: false,
  host: host,
  port: port,
  username: username,
  password: password
});

// leave options empty for guessing, otherwise specify the mods,
// channels and registries manually (channels and registries are only
// relevant for fml2 handshake)
const options = {
  forgeMods: undefined,
  channels: undefined,
  registries: undefined,
}

// add handler
autoVersionForge(client, options);

// set up logging
client.on('connect', function () {
  console.info('connected');
});
client.on('disconnect', function (packet) {
  console.log('disconnected: ' + packet.reason);
});
client.on('end', function (err) {
  console.log('Connection lost');
});
client.on('chat', function (packet) {
  console.log('Received chat message:', packet);
});

client.on('forgeMods', function (mods) {
  console.log('Received forgeMods event:', mods);
});
