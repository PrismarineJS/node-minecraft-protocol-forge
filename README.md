# minecraft-protocol-forge
[![NPM version](https://img.shields.io/npm/v/minecraft-protocol-forge.svg)](http://npmjs.com/package/minecraft-protocol-forge)
[![Join the chat at https://gitter.im/PrismarineJS/node-minecraft-protocol](https://img.shields.io/badge/gitter-join%20chat-brightgreen.svg)](https://gitter.im/PrismarineJS/node-minecraft-protocol)

Adds FML/Forge support to [node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) (requires 0.17+)

## Features

* Supports the `FML|HS` client handshake
* Adds automatic Forge mod detection to node-minecraft-protocol's auto-versioning

## Usage

Installable as a plugin for use with node-minecraft-protocol:

```javascript
var mc = require('minecraft-protocol');
var forgeHandshake = require('minecraft-protocol-forge').forgeHandshake;
var client = mc.createClient({
    host: host,
    port: port,
    username: username,
    password: password
});

forgeHandshake(client, {forgeMods: [
  { modid: 'mcp', version: '9.18' },
  { modid: 'FML', version: '8.0.99.99' },
  { modid: 'Forge', version: '11.15.0.1715' },
  { modid: 'IronChest', version: '6.0.121.768' }
]});
```

The `forgeMods` option is an array of modification identifiers and versions to present
to the server. Servers will kick the client if they do not have the required mods.

To automatically present the list of mods offered by the server, the `autoVersionForge`
plugin for node-minecraft-protocol's `autoVersion` (activated by `version: false`) can
be used:

```javascript
var mc = require('minecraft-protocol');
var autoVersionForge = require('minecraft-protocol-forge').autoVersionForge;
var client = mc.createClient({
    version: false,
    host: host,
    port: port,
    username: username,
    password: password
});

autoVersionForge(client);
```

This will automatically install the `forgeHandshake` plugin, with the appropriate mods,
if the server advertises itself as Forge/FML. Useful for connecting to servers you don't
know if they are Forge or not, or what mods they are using.

## Installation

`npm install minecraft-protocol-forge`

## Debugging

You can enable some protocol debugging output using `NODE_DEBUG` environment variable:

```bash
NODE_DEBUG="minecraft-protocol-forge" node [...]
```
