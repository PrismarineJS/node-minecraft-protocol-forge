/* eslint-env mocha */
const assert = require('assert')
const { once } = require('events')
const mc = require('minecraft-protocol')
const plugins = require('..')

// A controlled TCP peer exercises the real client state changes and codecs.
// It is not a Java proxy/backend-transfer compatibility test.
describe('configuration cycles over TCP', function () {
  this.timeout(10000)
  for (const version of ['1.20.4', '1.21.1', '1.21.11']) {
    for (const loader of ['forge', 'neoforge', 'fabric']) {
      it(`${loader} ${version} completes three configurations on one connection`, async () => {
        const server = new mc.Server(version)
        let client
        let peer
        let cycles = 0
        let transitions = 0
        let configurationAcks = 0
        const errors = []
        const onError = error => errors.push(error)
        server.on('error', onError)
        server.on('connection', connection => {
          peer = connection
          peer.on('error', onError)
          peer.on('set_protocol', () => { peer.state = 'login' })
          peer.on('login_start', () => peer.write('success', {
            uuid: '00000000-0000-0000-0000-000000000001', username: 'CycleTest', properties: []
          }))
          let replies = 0
          const payload = (channel, bytes) => peer.write('custom_payload', { channel, data: Buffer.from(bytes) })
          function configure () {
            peer.state = 'configuration'
            replies = 0
            if (loader === 'forge') {
              payload('forge:handshake', [1, 0])
              payload('forge:handshake', [2, 0])
              payload('forge:handshake', [3, cycles + 1, 0, 0])
            } else if (loader === 'neoforge') {
              payload('neoforge:register', version === '1.20.4' ? [0, 0] : [0])
            } else {
              payload('minecraft:register', Buffer.from('c:version\0c:register'))
              payload('c:version', [1, 1])
              payload('c:register', Buffer.concat([Buffer.from([1, 4]), Buffer.from('play'), Buffer.from([0])]))
            }
          }
          peer.on('login_acknowledged', configure)
          peer.on('configuration_acknowledged', () => {
            configurationAcks++
            configure()
          })
          peer.on('custom_payload', packet => {
            if (peer.state !== 'configuration') return
            if (loader === 'neoforge') {
              if (packet.channel === 'neoforge:register') {
                payload('neoforge:network', version === '1.20.4' ? [0, 0] : [2, 4, 0, 1, 0])
              } else if (packet.channel === 'minecraft:register') peer.write('finish_configuration', {})
            } else if (++replies === 3) peer.write('finish_configuration', {})
          })
          peer.on('finish_configuration', () => {
            cycles++
            peer.state = 'play'
            if (cycles < 3) peer.write('start_configuration', {})
          })
        })
        server.listen(0, '127.0.0.1')
        try {
          await once(server, 'listening')
          client = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port, version, username: 'CycleTest', auth: 'offline' })
          client.on('error', onError)
          if (loader === 'forge') plugins.forgeHandshakeModern(client)
          if (loader === 'neoforge') plugins.neoforgeHandshake(client)
          if (loader === 'fabric') plugins.fabricNetworking(client)
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Incomplete cycles: client ${transitions}, server ${cycles}; ${errors.map(e => e.message).join('; ')}`)), 5000)
            client.on('state', state => {
              if (state !== 'play') return
              transitions++
              if (transitions === 3) {
                clearTimeout(timeout)
                setTimeout(resolve, 25)
              }
            })
          })
          assert.deepStrictEqual(errors, [])
          assert.equal(cycles, 3)
          assert.equal(configurationAcks, 2)
          if (loader === 'forge') assert.equal(client.forgeHandshakeComplete, true)
          if (loader === 'neoforge') assert.equal(client.neoforgeHandshakeComplete, true)
        } finally {
          client?.socket?.destroy()
          peer?.socket?.destroy()
          await new Promise(resolve => server.socketServer.close(resolve))
        }
      })
    }
  }
})
