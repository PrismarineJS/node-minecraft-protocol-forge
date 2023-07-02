'use strict';

var forgeHandshake = require('./forgeHandshake');
const ByteBuffer = require("bytebuffer")

function decodeOptimized(s) {

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

  return buf
}

function fixedHex(number, length){
  var str = number.toString(16).toUpperCase();
  while(str.length < length)
      str = "0" + str;
  return str;
}

function unicodeLiteral(str){
  var i;
  var result = "";
  for( i = 0; i < str.length; ++i){ 
      if(str.charCodeAt(i) > 126 || str.charCodeAt(i) < 32) {
        console.log(result)
          result += "|"
      } else {
        result += str[i];
      }
  }

  return result;
}

function remove_non_ascii(str) {
  
  if ((str===null) || (str===''))
       return false;
 else
   str = str.toString();
  
  return str.replace(/[^\x20-\x7E]/g, '');
}

module.exports = function (client, options) {
  if (!client.autoVersionHooks) client.autoVersionHooks = [];

  client.autoVersionHooks.push(function (response, client, options) {
    var buff = decodeOptimized(response.forgeData.d)

    var mods_weird = remove_non_ascii(unicodeLiteral(buff.readString(buff.limit)))

    var list = mods_weird.match(/\|(.+)\|/)

    console.log(list)

    // Use the list of Forge mods from the server ping, so client will match server
    // var forgeMods = response.modinfo.modList;
    // console.log('Using forgeMods:', forgeMods);

    // Install the FML|HS plugin with the given mods
    // forgeHandshake(client, { forgeMods: forgeMods });
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
};
