// https://github.com/SeraphJACK/SimpleLogin/blob/mc-1.19/src/main/java/top/seraphjack/simplelogin/network/MessageLogin.java

const Client = require("minecraft-protocol").Client;
const { SHA256 } = require('crypto-js');

const toBytes = (text) => {
    const result = [];
    for (let i = 0; i < text.length; i += 1) {
        const hi = text.charCodeAt(i);
        if (hi < 0x0080) {
            // code point range: U+0000 - U+007F
            // bytes: 0xxxxxxx
            result.push(hi);
            continue;
        }
        if (hi < 0x0800) {
            // code point range: U+0080 - U+07FF
            // bytes: 110xxxxx 10xxxxxx
            result.push(0xC0 | hi >> 6,
                        0x80 | hi       & 0x3F);
            continue;
        }
        if (hi < 0xD800 || hi >= 0xE000 ) {
            // code point range: U+0800 - U+FFFF
            // bytes: 1110xxxx 10xxxxxx 10xxxxxx	
            result.push(0xE0 | hi >> 12,
                        0x80 | hi >>  6 & 0x3F,
                        0x80 | hi       & 0x3F);
            continue;
        }
        i += 1;
        if (i < text.length) {
            // surrogate pair
            const lo = text.charCodeAt(i);
            const code = 0x00010000 + (hi & 0x03FF) << 10 | lo & 0x03FF;
            // code point range: U+10000 - U+10FFFF
            // bytes: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
            result.push(0xF0 | code >> 18,
                        0x80 | code >> 12 & 0x3F,
                        0x80 | code >>  6 & 0x3F,
                        0x80 | code       & 0x3F);
        } else {
            break;
        }
    }
    return result;
};

function byte2Hex(bytes) {
  const hexChars = [];
  for (let i = 0; i < bytes.length; ++i) {
    let hex = (bytes[i] & 0xff).toString(16);
    if (hex.length === 1) {
      hex = '0' + hex;
    }
    hexChars.push(hex);
  }
  return hexChars.join('');
}

function hash256(pwd) {
	const hash = SHA256(pwd).toString();
	const hash_bytes = toBytes(hash);
	const hash_hex = byte2Hex(hash_bytes);
	return hash_hex;
};

/**
 * Simple Login message to the server.
 */
module.exports = function (client, options) {
  client.on("custom_payload", function (packet) {
    if (packet.channel === "simplelogin:main") {
		const sl_pwd = options.sl_pwd;
		const hashedPassword = hash256(sl_pwd).toString();
		const len = Buffer.alloc(4);
		const buffer = Buffer.concat([len, Buffer.from(hashedPassword, 'utf-8')]);
		client.write('custom_payload', {
			channel: 'simplelogin:main',
			data: buffer,
		});
    };
  });
};