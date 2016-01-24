'use strict';

var mc = require('minecraft-protocol');
var assert = require('assert');
var fml = require('./fml');

function createClientForge(options) {
  assert.ok(options, 'options is required');
  var port = options.port || 25565;
  var host = options.host || 'localhost';

  //options.tagHost = '\0FML\0'; // signifies client supports FML/Forge TODO: pr to nmp?
  // works in released minecraft-protocol 0.16.6, but how does it interact with DNS SRV resolution? maybe not be completely correct!
  options.host += '\0FML\0';

  var client = mc.createClient(options);

  client.on('custom_payload', function(packet) {
    // TODO: channel registration tracking in NMP, https://github.com/PrismarineJS/node-minecraft-protocol/pull/328
    if (packet.channel === 'FML|HS') {
      fml.fmlHandshakeStep(client, packet.data);
    }
  });

  return client;
}

module.exports = createClientForge;
