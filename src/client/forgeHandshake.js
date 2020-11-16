const { ProtoDefCompiler } = require('protodef').Compiler
const assert = require('assert/strict')
const debug = require('../../debug')

const FMLHandshakeClientState = {
	START: 1,
	WAITINGSERVERDATA: 2,
	WAITINGSERVERCOMPLETE: 3,
	PENDINGCOMPLETE: 4,
	COMPLETE: 5,
}

const compiler = new ProtoDefCompiler()
compiler.addTypesToCompile({
	// copied from ../../dist/transforms/serializer.js TODO: refactor
	string: ['pstring', { countType: 'varint' }],

	// http://wiki.vg/Minecraft_Forge_Handshake
	// TODO: move to https://github.com/PrismarineJS/minecraft-data
	'fml|hsMapper': ,
	'FML|HS': [
		'container',
		[
			{
				name: 'discriminator',
				type: [
					'mapper',
					{
						type: 'i8',
						mappings: {
							0: 'ServerHello',
							1: 'ClientHello',
							2: 'ModList',
							3: 'RegistryData',
							'-1': 'HandshakeAck',
							'-2': 'HandshakeReset'
						}
					}
				]
			},
			{
				anon: true,
				type: [
					'switch',
					{
						compareTo: 'discriminator',
						fields: {
							ServerHello: [
								'container',
								[
									{
										name: 'fmlProtocolVersion',
										type: 'i8'
									},
									{
										name: 'overrideDimension',
										type: [
											'switch', 
											{
												// 'Only sent if protocol version is greater than 1.'
												compareTo: 'fmlProtocolVersion',
												fields: {
													0: 'void',
													1: 'void'
												},
												'default': 'i32'
											}
										]
									}
								]
							],

							ClientHello: [
								'container',
								[
									{
										name: 'fmlProtocolVersion',
										type: 'i8'
									}
								]
							],

							ModList: [
								'container',
								[
									{
										name: 'mods',
										type: [
											'array',
											{
												countType: 'varint',
												type: [
													'container',
													[
														{
															name: 'modid',
															type: 'string'
														},
														{
															name: 'version',
															type: 'string'
														}
													]
												]
											}
										]
									}
								]
							],

							RegistryData: [
								'container',
								[
									{
										name: 'hasMore',
										type: 'bool'
									},

									/* TODO: support all fields http://wiki.vg/Minecraft_Forge_Handshake#RegistryData
									 * TODO: but also consider http://wiki.vg/Minecraft_Forge_Handshake#ModIdData
									 *	and https://github.com/ORelio/Minecraft-Console-Client/pull/100/files#diff-65b97c02a9736311374109e22d30ca9cR297
									{
										name: 'registryName',
										type: 'string'
									},
									*/
								]
							],
							HandshakeAck: [
								'container',
								[
									{
										name: 'phase',
										type: 'i8'
									}
								]
							]
						}
					}
				]
			}
		]
	]
})

// Compile a ProtoDef instance
const proto = compiler.compileProtoDefSync()

function fmlHandshakeStep (client, data, options) {
	function writeAck (phase) {
		client.write('custom_payload', {
			channel: 'FML|HS',
			data: proto.createPacketBuffer('FML|HS', { discriminator: 'HandshakeAck', phase })
		})
	}
	const parsed = proto.parsePacketBuffer('FML|HS', data)
	debug('FML|HS', parsed)
	const { discriminator, mods, phase } = parsed.data

	const fmlHandshakeState = client.fmlHandshakeState || FMLHandshakeClientState.START

	switch (fmlHandshakeState) {
		case FMLHandshakeClientState.START:
		{
			assert.strictEqual(discriminator, 'ServerHello', `expected ServerHello in START state, got ${discriminator}`)

			const { fmlProtocolVersion } = parsed.data
			if (fmlProtocolVersion > 2) {
				// TODO: support higher protocols, if they change
			}

			client.write('custom_payload', {
				channel: 'REGISTER',
				data: new Buffer(['FML|HS', 'FML', 'FML|MP', 'FML', 'FORGE'].join('\0'))
			})

			client.write('custom_payload', {
				channel: 'FML|HS',
				data: proto.createPacketBuffer('FML|HS', {
					discriminator: 'ClientHello',
					fmlProtocolVersion
				})
			})

			debug('Sending client modlist')
			client.write('custom_payload', {
				channel: 'FML|HS',
				data: proto.createPacketBuffer('FML|HS', {
					discriminator: 'ModList',
					mods: options.forgeMods || []
				})
			})

			writeAck(client, FMLHandshakeClientState.WAITINGSERVERDATA)
			client.fmlHandshakeState = FMLHandshakeClientState.WAITINGSERVERDATA
			break
		}

		case FMLHandshakeClientState.WAITINGSERVERDATA:
		{
			assert.strictEqual(discriminator, 'ModList', `expected ModList in WAITINGSERVERDATA state, got ${discriminator}`)
			const { mods } = parsed.data
			debug('Server ModList:', mods)
			// Emit event so client can check client/server mod compatibility
			client.emit('forgeMods', mods)
			client.fmlHandshakeState = FMLHandshakeClientState.WAITINGSERVERCOMPLETE
			break
		}

		case FMLHandshakeClientState.WAITINGSERVERCOMPLETE:
		{
			assert.strictEqual(discriminator, 'RegistryData', `expected RegistryData in WAITINGSERVERCOMPLETE, got ${discriminator}`)
			debug('RegistryData', parsed.data)
			console.log('RegistryData', parsed)

			// actually ModIdData packet, and there is only one of those TODO: avoid hardcoding version, allow earlier
			if (client.version === '1.7.10' || parsed.data.hasMore === false) {
				// RegistryData packet 1.8+ hasMore boolean field, set to false when ready to ack
				debug('LAST RegistryData')

				writeAck(client, FMLHandshakeClientState.WAITINGSERVERCOMPLETE)
				client.fmlHandshakeState = FMLHandshakeClientState.PENDINGCOMPLETE
			}
			break
		}

		case FMLHandshakeClientState.PENDINGCOMPLETE:
		{
			assert.strictEqual(discriminator, 'HandshakeAck', `expected HandshakeAck in PENDINGCOMPLETE, got ${discrimnator}`)
			assert.strictEqual(parsed.data.phase, 2, `expected HandshakeAck phase WAITINGACK, got ${parsed.data.phase}`)
			writeAck(client, FMLHandshakeClientState.PENDINGCOMPLETE4)
			client.fmlHandshakeState = FMLHandshakeClientState.COMPLETE
			break
		}

		case FMLHandshakeClientState.COMPLETE:
		{
			assert.ok(parsed.data.phase === 3, `expected HandshakeAck phase COMPLETE, got ${parsed.data.phase}`)

			writeAck(client, FMLHandshakeClientState.COMPLETE)
			debug('HandshakeAck Complete!')
			break
		}

		default:
			console.error(`unexpected FML state ${fmlHandshakeState}`)
	}
}

module.exports = function(client, options) {
	client.tagHost = '\0FML\0'
	// passed to src/client/setProtocol.js, signifies client supports FML/Forge
	client.on('custom_payload', packet => {
		// TODO: channel registration tracking in NMP, https://github.com/PrismarineJS/node-minecraft-protocol/pull/328
		if (packet.channel === 'FML|HS') {
			fmlHandshakeStep(client, packet.data, options)
		}
	})
}
