'use strict';

var assert = require('assert');
var expect = require('chai').expect;

var getReader = function(dataType) { return dataType[0]; };
var getWriter = function(dataType) { return dataType[1]; };
var getSizeOf = function(dataType) { return dataType[2]; };

var varshort = require('../varshort');

describe('.varshort', function() {
 it('Reads short integer', function() {
   var buf = new Buffer([0x01, 0x02]);
   expect(getReader(varshort)(buf, 0, [], {})).to.deep.equal({
     value: 0x0102,
     size: 2
   });
 });
 it('Reads short integer maximum', function() {
   var buf = new Buffer([0x7f, 0xff]);
   expect(getReader(varshort)(buf, 0, [], {})).to.deep.equal({
     value: 0x7fff,
     size: 2
   });
 });
 it('Reads varshort integer', function() {
   var buf = new Buffer([0xe4, 0x47, 0x07]);
   expect(getReader(varshort)(buf, 0, [], {})).to.deep.equal({
     value: 255047,
     size: 3
   });
 });
 it('Reads varshort integer minimum', function() {
   var buf = new Buffer([0x80, 0x00, 0x01]);
   expect(getReader(varshort)(buf, 0, [], {})).to.deep.equal({
     value: 0x8000,
     size: 3
   });
 });
 it('Reads varshort integer maximum', function() {
   var buf = new Buffer([0xff, 0xff, 0xff]);
   expect(getReader(varshort)(buf, 0, [], {})).to.deep.equal({
     value: 0x7fffff,
     size: 3
   });
 });


 it('Size of short integer', function() {
   assert.equal(getSizeOf(varshort)(0x0102), 2);
 });
 it('Size of varshort integer', function() {
   assert.equal(getSizeOf(varshort)(255047), 3);
 });
 it('Size of too big', function() {
  try {
    getSizeOf(varshort)(0x800000);
    throw new Error('unexpectedly returned from size of too big');
  } catch(e) {
    assert.ok(e.name, 'AssertionError');
  }
 });
 it('Size of too small', function() {
  try {
    getSizeOf(varshort)(-1);
    throw new Error('unexpectedly returned from size of too small');
  } catch(e) {
    assert.ok(e.name, 'AssertionError');
  }
 });

 it('Writes short integer', function() {
  var buf = new Buffer(2);
  assert.equal(getWriter(varshort)(0x0102, buf, 0, [], {}), 2);
  assert.deepEqual(buf, new Buffer([0x01, 0x02]));
 });
 it('Writes short integer maximum', function() {
  var buf = new Buffer(2);
  assert.equal(getWriter(varshort)(0x7fff, buf, 0, [], {}), 2);
  assert.deepEqual(buf, new Buffer([0x7f, 0xff]));
 });
 it('Writes varshort integer', function() {
  var buf = new Buffer(3);
  assert.equal(getWriter(varshort)(255047, buf, 0, [], {}), 3);
  assert.deepEqual(buf, new Buffer([0xe4, 0x47, 0x07]));
 });
 it('Writes varshort integer minimum', function() {
  var buf = new Buffer(3);
  assert.equal(getWriter(varshort)(0x8000, buf, 0, [], {}), 3);
  assert.deepEqual(buf, new Buffer([0x80, 0x00, 0x01]));
 });
 it('Writes varshort integer maximum', function() {
  var buf = new Buffer(3);
  assert.equal(getWriter(varshort)(0x7fffff, buf, 0, [], {}), 3);
  assert.deepEqual(buf, new Buffer([0xff, 0xff, 0xff]));
 });
});
