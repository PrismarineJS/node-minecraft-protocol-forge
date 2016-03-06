'use strict';

var assert = require('assert');

/* Implements the 'varshort' data type from Minecraft Forge
 *
 * http://wiki.vg/Minecraft_Forge_Handshake#Differences_from_Forge_1.7.10 "However, forge makes some more changes to the server to client packet 0x3f: Rather than using a short for the length, a varshort is used"
 */

function readVarShort(buffer, offset) {
  var size = 2;
  if(offset + size > buffer.length)
    throw new PartialReadError();
  var low = buffer.readUInt16BE(offset);
  offset += size;
  var high = 0;
  if (low & 0x8000) {
    low &= 0x7fff;

    size += 1;
    if (offset + 1 > buffer.length)
      throw new PartialReadError();

    high = buffer.readUInt8(offset);
  }

  var value = (high << 15) | low;

  return {
    value: value,
    size: size
  };
}

function sizeOfVarShort(value) {
  assert.ok(value >= 0 && value <= 0x7fffff, 'varshort out of range');
  var high = (value & 0x7f8000) >>> 15;
  if (high) {
    return 3;
  } else {
    return 2;
  }
}

function writeVarShort(value, buffer, offset) {
  assert.ok(value >= 0 && value <= 0x7fffff, 'varshort out of range');
  var low = value & 0x7fff;
  var high = (value & 0x7f8000) >>> 15;
  if (high) {
    low |= 0x8000;
  }

  buffer.writeUInt16BE(low, offset);
  offset += 2;

  if (high) {
    buffer.writeUInt8(high, offset);
    offset += 1;
  }

  return offset;
}

module.exports = [
  readVarShort,
  writeVarShort,
  sizeOfVarShort,
];
