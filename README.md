# minecraft-protocol-forge
[![NPM version](https://img.shields.io/npm/v/minecraft-protocol-forge.svg)](http://npmjs.com/package/minecraft-protocol-forge)
[![Build Status](https://img.shields.io/circleci/project/deathcap/node-minecraft-protocol-forge/master.svg)](https://circleci.com/gh/deathcap/node-minecraft-protocol-forge)
[![Join the chat at https://gitter.im/PrismarineJS/node-minecraft-protocol](https://img.shields.io/badge/gitter-join%20chat-brightgreen.svg)](https://gitter.im/PrismarineJS/node-minecraft-protocol)

Adds FML/Forge support to [node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol)

## Features

* Supports the `FML|HS` client handshake

## Usage

Should be usable nearly the same as node-minecraft-protocol, but will
automatically perform the FML/Forge handshake. Try the included example:

    npm start

## API

`createClient(options)` returns a node-minecraft-protocol client, with
additionally the following:

### .forgeMods property

Set to an array of objects with `modid` and `version` properties supported
by the client. You can get this from the ping packet, or the server may reject you
for not having th required mods installed.

### "forgeMods" event

Emitted with a list of the server's mods, when received.

## Installation

`npm install minecraft-protocol-forge`

## Debugging

You can enable some protocol debugging output using `NODE_DEBUG` environment variable:

```bash
NODE_DEBUG="minecraft-protocol-forge" node [...]
```

## History

See https://github.com/PrismarineJS/node-minecraft-protocol/pull/326
