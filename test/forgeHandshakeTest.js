'use strict'
/* eslint-env mocha */

const assert = require('assert')
const { EventEmitter } = require('events')
const forgeHandshake = require('../src/client/forgeHandshake')

describe('FML1 initial state', () => {
  for (const reset of [false, true]) {
    it(`completes the acknowledgment state sequence ${reset ? 'with' : 'without'} an initial reset`, () => {
      const client = new EventEmitter()
      client.version = '1.12.2'
      const writes = []
      client.write = (name, packet) => { if (packet.channel === 'FML|HS') writes.push(packet.data.toString('hex')) }
      forgeHandshake(client, { forgeMods: [] })
      const receive = hex => client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from(hex, 'hex') })
      if (reset) receive('fe')
      receive('000200000000') // ServerHello, protocol 2, dimension 0
      receive('0200') // Empty server ModList
      receive('0300') // RegistryData state-machine prefix: final registry
      receive('ff02')
      receive('ff03')
      assert.deepStrictEqual(writes, ['0102', '0200', 'ff02', 'ff03', 'ff04', 'ff05'])
      assert.equal(client.fmlHandshakeState, 5)
    })
  }

  for (const resetBytes of ['fe', 'fe00']) {
    it(`restarts a completed handshake on reset ${resetBytes} without skipping registries`, () => {
      const client = new EventEmitter()
      client.version = '1.12.2'
      const writes = []
      client.write = (name, packet) => { if (packet.channel === 'FML|HS') writes.push(packet.data.toString('hex')) }
      forgeHandshake(client, { forgeMods: [] })
      const receive = hex => client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from(hex, 'hex') })
      for (let cycle = 0; cycle < 3; cycle++) {
        if (cycle) {
          const before = writes.length
          receive(resetBytes)
          assert.equal(writes.length, before)
          assert.equal(client.fmlHandshakeState, 1)
        }
        receive('000200000000')
        receive('0200')
        assert.equal(client.fmlHandshakeState, 3)
        receive('0300')
        receive('ff02')
        receive('ff03')
        assert.deepStrictEqual(writes.slice(cycle * 6), ['0102', '0200', 'ff02', 'ff03', 'ff04', 'ff05'])
      }
    })
  }

  it('still rejects an unrelated initial handshake message', () => {
    const client = new EventEmitter()
    client.write = () => {}
    forgeHandshake(client, { forgeMods: [] })
    assert.throws(() => client.emit('custom_payload', {
      channel: 'FML|HS', data: Buffer.from('0200', 'hex')
    }), /expected ServerHello/)
  })
})
