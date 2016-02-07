'use strict';

var forgeHandshake = require('./forgeHandshake');

module.exports = function(client, options) {
  if (!client.autoVersionHooks) client.autoVersionHooks = [];

  client.autoVersionHooks.push(function(response, client, options) {
    if (!response.modinfo || response.modinfo.type !== 'FML') {
      return; // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    var forgeMods = response.modinfo.modList;
    console.log('Using forgeMods:',forgeMods);

    // Install the FML|HS plugin with the given mods
    forgeHandshake(client, {forgeMods: forgeMods});
  });
};
