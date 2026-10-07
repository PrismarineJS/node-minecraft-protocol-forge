'use strict'

module.exports = {
  forgeHandshake: require('./src/client/forgeHandshake'),
  forgeHandshakeModern: require('./src/client/forgeHandshakeModern'),
  fabricNetworking: require('./src/client/fabricNetworking'),
  installFabricRegistryMappings: require('./src/client/fabricRegistryMappings'),
  resetFabricRegistryMappings: require('./src/client/fabricRegistryMappings').reset,
  neoforgeHandshake: require('./src/client/neoforgeHandshake'),
  autoVersionForge: require('./src/client/autoVersionForge')
}
