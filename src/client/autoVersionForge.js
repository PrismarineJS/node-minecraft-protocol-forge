'use strict';

var forgeHandshake = require('./forgeHandshake');
var forgeHandshake2 = require('./forgeHandshake2')
var forgeHandshake3 = require('./forgeHandshake3')

const ByteBuffer = require("bytebuffer")

function unicodeLiteral(str){
  var i;
  var result = "";
  var checker = true;

  for( i = 0; i < str.length; ++i){ 
    if ((i + 1) === str.length) break;

      if(str.charCodeAt(i) > 126 || str.charCodeAt(i) < 32) {
        if (checker) continue

        result += "|"
        checker = true
      } else {
        result += str[i];
        checker = false
      }
  }
  return result
}


function remove_non_ascii(str) {
  
  if ((str===null) || (str===''))
       return false;
 else
   str = str.toString();
  
  return str.replace(/[^\x20-\x7E]/g, '');
}

function parse_data(s) {

  var buf = new ByteBuffer()

  var stringIndex = 2
  var buffer = 0
  var bitsInBuf = 0

  while (stringIndex < s.length) {
      while (bitsInBuf >= 8) {
          buf.writeByte(buffer)
          buffer >>>= 8
          bitsInBuf -= 8
      }

      buffer |= (s.charCodeAt(stringIndex) & 0x7FFF) << bitsInBuf
      bitsInBuf += 15
      stringIndex++
  }

  buf.flip()

  var parsed = remove_non_ascii(unicodeLiteral(buf.readString(buf.limit))).split("|")

  var index = 0

  var forgeMods = []
  var modNames = []
  var channels = [
    {name: "fml:play", marker: "FML3"}
  ]

  while (index < parsed.length) {

    let modid = parsed[index]
    let version = parsed[index+1]

    if (["register", "unregister"].includes(modid)) {

      channels.push(
        {
        name : `minecraft:${modid}`,
        marker : "FML3"
        }
      )

      index += 2
      continue
    }

    if (modid === "tier_sorting") {

      channels.push({
        name : `forge:${modid}`,
         marker : "1.0"
      })

      index += 2
      continue
    }
    if (modid === "split") {
      channels.push({
        name : `forge:${modid}`,
        marker : "1.1"
      })

      index += 2
      continue
    }

    if (parsed[index+2] === "main_channel") {
      let channel = `${modid}:main_channel`
      let version = parsed[index+3]

      channels.push({name : channel, marker : version})
      index += 4
      continue
    }
    index += 2

    forgeMods.push(
      {"modId" : modid, "marker": version}
    )
    modNames.push(modid)
  }

  return { forgeMods, channels, modNames }
}

module.exports = function (client, options) {
  if (!client.autoVersionHooks) client.autoVersionHooks = [];

  client.autoVersionHooks.push(function (response, client, options) {

    if (!response.modinfo || response.modinfo.type !== 'FML') {
      return; // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    var forgeMods = response.modinfo.modList;
    console.log('Using forgeMods:', forgeMods);

    // Install the FML|HS plugin with the given mods
    forgeHandshake(client, { forgeMods: forgeMods });
  });

  client.autoVersionHooks.push(function (response, client, options) {
    if (!response.forgeData || response.forgeData.fmlNetworkVersion !== 2) {
      return; // not ours
    }

    // Use the list of Forge mods from the server ping, so client will match server
    var forgeMods = response.forgeData.mods;
    console.log('Using forgeMods:', forgeMods);

    // Install the FML|HS plugin with the given mods
    forgeHandshake2(client, { forgeMods });
  });

  client.autoVersionHooks.push(function (response, client, options) {
    if (!response.forgeData || !response.forgeData.d) {
      return // not ours
    }

    var forgeData = parse_data(response.forgeData.d)

    var mods = forgeData.forgeMods
    var channels = forgeData.channels
    var modNames = forgeData.modNames

    console.log(modNames)

    forgeHandshake3(client, { mods, channels, modNames })
  })
}
