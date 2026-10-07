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

Explicit mod lists can be supplied to auto-versioning. FML2 and FML3 use mod ID
strings; FML1 uses objects with `modid` and `version` fields. FML3 also accepts
handlers for mod messages inside `fml:loginwrapper`:

```javascript
autoVersionForge(client, {
  forgeMods: ['examplemod'],
  channels: { 'examplemod:handshake': '1' },
  loginHandlers: {
    'examplemod:handshake': data => handleExampleModHandshake(data)
  }
})
```

Implement `handleExampleModHandshake` using the mod's protocol. It receives the
inner channel payload and returns a Buffer containing the inner response, or
undefined to decline the request. Unhandled mod channels inside the FML3 login
wrapper are declined and emitted as `forgeLoginPluginRequest`.

Advertising a mod list or acknowledging registry data does not implement the
mod's gameplay, custom packets, or dynamic registry mappings. Applications must
provide those capabilities separately. Login handlers currently apply to FML3;
they do not implement Fabric or modern Forge configuration networking.

### Modern Forge configuration (experimental)

The separate `forgeHandshakeModern(client, options)` export implements the
configuration-phase Forge network-version-0 exchange. `autoVersionForge` selects
it when the server advertises `forgeData.fmlNetworkVersion: 0`. The explicit export
is useful when the Minecraft version is supplied directly. Do not install both
handlers on the same client. Unknown network versions are not guessed.

Options are `modVersions` (objects with `id`, `name`, and `version`), `channels`
(channel names mapped to numeric versions), and `dataPackRegistries` (supported
registry names). Omitted mod versions are reflected from the server. Only the
Forge handshake/login channels are advertised by default. Additional mod-channel
implementations remain the application's responsibility.

Registry ID entries are exposed in `client.forgeRegistries` and through
`forgeRegistry`; raw config contents are emitted through `forgeConfig`, never
written to disk. Receiving these does not implement the corresponding mod's
gameplay. `client.forgeHandshakeComplete` becomes true after the configuration
exchange completes and the client enters play.

This will automatically install the `forgeHandshake` plugin, with the appropriate mods,
if the server advertises itself as Forge/FML. Useful for connecting to servers you don't
know if they are Forge or not, or what mods they are using.

### Fabric networking

`fabricNetworking(client, options)` handles early play-channel registration and
common networking version 1. Supply `configurationHandlers` and `playHandlers`
as objects mapping channel names to functions receiving `(data, { client, phase })`.
Only supplied handlers and the implemented common channels are advertised.
Handlers implement their mod's payload format and any required replies.

Optional `loginHandlers` map login-query channel names to functions receiving
`(data, { client, messageId })`. Return a Buffer (or a Promise resolving to one)
to reply, or undefined to decline. Unknown queries are declined. Fabric early
registration is handled internally and cannot be overridden.

The returned object's `remoteChannels` contains separate configuration/play Sets.
`fabricChannels` reports common registration updates. Install this plugin instead
of a Forge/NeoForge handshake on the same client.

On 1.21.11, optional `registryHandler(registries, { client })` enables Fabric
registry synchronization. `registries` is a Map from namespaced registry names
to `{ optional, entries }`, where `entries` maps namespaced entry names to IDs.
The handler must synchronously validate and apply the mappings to the application's
consumers, then return `true`. Otherwise synchronization fails without acknowledging
completion. `fabricRegistries` is emitted after acceptance. No registry channel
is advertised by default.

`installFabricRegistryMappings(client, registries, codecs)` can apply synchronized
sound-event IDs and install per-client item-component and particle schemas. `codecs`
contains `dataComponentTypes` and `particleTypes` objects keyed by namespaced registry
entry. Their values are ProtoDef type definitions implementing the mod's exact wire
format. Missing custom codecs, unsupported registries, shared-schema changes, and
conflicts with caller schemas are rejected. Only Minecraft 1.21.11 is currently
verified. For example:

```javascript
const forge = require('minecraft-protocol-forge')

forge.fabricNetworking(client, {
  registryHandler: registries => forge.installFabricRegistryMappings(client, registries, {
    particleTypes: { 'example:spark': ['container', sparkFields] },
    dataComponentTypes: { 'example:mode': 'anonymousNbt' }
  })
})
```

The application must obtain these codecs from the mod's protocol; the library does
not infer them or treat successful registry synchronization as general mod support.

### NeoForge networking

`neoforgeHandshake(client, options)` supports the configuration protocols exercised
on Minecraft 1.20.4, 1.21.1 and 1.21.11. Set the Minecraft version when creating the client;
NeoForge automatic detection is not implemented.

`configurationChannels` and `playChannels` map channel names to objects containing
`version`, `handler`, optional `flow` (`clientbound` or `serverbound`, omitted for
both directions), and `optional` (false by default). Incoming channels require a
handler receiving `(data, { client, phase })`. Server channels are not reflected
automatically.

Built-in handlers synchronize frozen registry IDs and aliases and install the
command-argument mapping. Snapshots are exposed in `client.neoforgeRegistries`
and through `neoforgeRegistry`. Other gameplay systems must consume these mappings
themselves. On 1.21.1 and 1.21.11, compatibility checks reject unsupported enum extensions and
modded feature flags rather than acknowledging capabilities that are absent.

On 1.21.11, the default `neoforge:recipe_content` handler accepts only empty
recipe synchronization and emits `neoforgeRecipes`. Nonempty recipe data fails
explicitly; supply a registry-aware `playChannels` handler for mods that sync
recipes. This is not general modded recipe support.

`client.neoforgeHandshakeComplete` indicates channel negotiation and any negotiated
registry synchronization completed before entering play. It does not certify mod
gameplay support. Configuration pings are answered by default; set
`respondToPing: false` if the application handles those packets itself.

## Installation

Requires Node.js 22 or newer.

`npm install minecraft-protocol-forge`

## Debugging

You can enable some protocol debugging output using `NODE_DEBUG` environment variable:

```bash
NODE_DEBUG="minecraft-protocol-forge" node [...]
```
