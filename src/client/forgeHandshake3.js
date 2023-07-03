const ProtoDef = require("protodef").ProtoDef;
const Client = require("minecraft-protocol").Client
const debug = require("debug")("minecraft-protocol-forge")

// Channels
const FML_CHANNELS = {
  LOGINWRAPPER: "fml:loginwrapper",
  HANDSHAKE: "fml:handshake"
};

const PROTODEF_TYPES = {
  LOGINWRAPPER: "fml_loginwrapper",
  HANDSHAKE: "fml_handshake"
};

// Initialize Proto
const proto = new ProtoDef(false);

// copied from ../../dist/transforms/serializer.js
proto.addType("string", [
  "pstring",
  {
    countType: "varint",
  },
]);

// copied from node-minecraft-protocol
proto.addTypes({
  restBuffer: [
    (buffer, offset) => {
      return {
        value: buffer.slice(offset),
        size: buffer.length - offset,
      };
    },
    (value, buffer, offset) => {
      value.copy(buffer, offset);
      return offset + value.length;
    },
    (value) => {
      return value.length;
    },
  ],
});



proto.addProtocol(require("./data/fml3.json"), ["fml3"])

/**
 * FML3 handshake to the server.
 * ! There is no wiki for it.
 * @param {import('minecraft-protocol').Client} client client that is connecting to the server.
 * @param {{
*  forgeMods: Array.<string> | undefined,
*  channels: Object.<string, string> | undefined,
*  registries: Object.<string, string> | undefined
* }} options
*/

module.exports = function (client, options) {

  const mods = options.mods;
  const channels = options.channels;
  const registries = options.registries;

  client.tagHost = "\0FML3\0";
  debug("Initialized FML2 handler")
  if (!mods) {
    debug("Trying to guess mods by reflecting the server")
  } else {
    debug("Mods:", mods)
  }
  if (!channels) {
    debug("trying to guess channels by reflecting the servers'")
  } else {
    Object.entries(channels).forEach((name, marker) => {
      debug("channel", name, marker)
    })
  }
  if (!registries) {
    debug("trying to guess registries by reflecting the servers'")
  } else {
    Object.entries(registries).forEach((name, marker) => {
      debug("registry", name, marker)
    })
  }

  client.registerChannel("fml:loginwrapper", proto.types.fml_loginwrapper, false)

  // remove default login_plugin_request listener which would answer with an empty packet
  // and make the server disconnect us
  let nmplistener = client.listeners('login_plugin_request').find((fn) => fn.name == 'onLoginPluginRequest')
  client.removeListener('login_plugin_request', nmplistener)

  client.on("login_plugin_request", (data) => {

    // 0: ModData
    // 1: ModList

    // 2 -> 20 Registry Data
    // 21: Configuration

    if (data.channel === "fml:loginwrapper") {
      // parse buffer
      const { data: loginwrapper } = proto.parsePacketBuffer(
        PROTODEF_TYPES.LOGINWRAPPER,
        data.data
      );

      if (!loginwrapper.channel) {
        console.error(loginwrapper);
      }

      console.log(data.messageId)

      if (!loginwrapper.channel) {
        console.error(loginwrapper);
      }

      switch (data.messageId) {

        // ModData
        case (0):
          console.log("Mod data recrieved, No response.")
          break;

        case (1):
          console.log("Mod List recieved, Should reply with modListReply!")

          const modlistreply = {
            modNames: options.modNames,
            channels: [],
            registries: []
          }

          const modlistreplypacket = proto.createPacketBuffer(
            PROTODEF_TYPES.HANDSHAKE,
            {
              discriminator: "ModListReply",
              data: modlistreply,
            }
          );

          // loginWrapperPacket = proto.createPacketBuffer(
          //   PROTODEF_TYPES.LOGINWRAPPER,
          //   {
          //     channel: FML_CHANNELS.HANDSHAKE,
          //     data: modlistreplypacket,
          //   }
          // );
          // console.log(modlistreplypacket)


          // // client.write("login_plugin_response", {
          // //   messageId: data.messageId,
          // //   data: loginWrapperPacket,
          // // });
          // break

        case (21):
          console.log("This is configuration, should reply with Acknowledgement!")

          let AcknowledgementPacket = proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, { discriminator: "Acknowledgement" });

          let loginWrapperPacket = proto.createPacketBuffer(PROTODEF_TYPES.LOGINWRAPPER, { channel: FML_CHANNELS.HANDSHAKE, data: AcknowledgementPacket, });

          client.write("login_plugin_response", { messageId: data.messageId, data: loginWrapperPacket });

          break

        default:
          if (data.messageId > 1 && data.messageId < 21) {
            console.log("Registry data, should reply with Acknowledgement!")

            let AcknowledgementPacket = proto.createPacketBuffer(PROTODEF_TYPES.HANDSHAKE, { discriminator: "Acknowledgement" });

            let loginWrapperPacket = proto.createPacketBuffer(PROTODEF_TYPES.LOGINWRAPPER, { channel: FML_CHANNELS.HANDSHAKE, data: AcknowledgementPacket, });

            client.write("login_plugin_response", { messageId: data.messageId, data: loginWrapperPacket });

            break
          }
      }
    }
  })
}