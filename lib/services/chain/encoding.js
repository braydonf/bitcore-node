'use strict';

var bitcore = require('bitcore-lib');
var Address = bitcore.Address;
var constants = require('./constants');
var $ = bitcore.util.preconditions;

var exports = {};

/**
 * This function is optimized to return address information about an output script
 * without constructing a Bitcore Address instance.
 * @param {Script} - An instance of a Bitcore Script
 * @param {Network|String} - The network for the address
 */
exports.extractAddressInfoFromScript = function(script) {
  var hashBuffer;
  var addressType;
  var hashTypeBuffer;
  if (script.isPublicKeyHashOut()) {
    hashBuffer = script.chunks[2].buf;
    hashTypeBuffer = constants.HASH_TYPES.PUBKEY;
    addressType = Address.PayToPublicKeyHash;
  } else if (script.isScriptHashOut()) {
    hashBuffer = script.chunks[1].buf;
    hashTypeBuffer = constants.HASH_TYPES.REDEEMSCRIPT;
    addressType = Address.PayToScriptHash;
  } else {
    return false;
  }
  return {
    hashBuffer: hashBuffer,
    hashTypeBuffer: hashTypeBuffer,
    addressType: addressType
  };
};

exports.encodeBlockIndexKey = function(timestamp) {
  $.checkArgument(timestamp >= 0 && timestamp <= 4294967295, 'timestamp out of bounds');
  var timestampBuffer = new Buffer(4);
  timestampBuffer.writeUInt32BE(timestamp);
  return timestampBuffer;
};

exports.encodeBlockIndexValue = function(hash, transactionsLength, bytes) {
  var transactionCountBuffer = new Buffer(new Array(9));
  transactionCountBuffer.writeDoubleBE(transactionsLength);
  var bytesBuffer = new Buffer(new Array(8));
  bytesBuffer.writeDoubleBE(bytes);
  var hashBuffer = new Buffer(hash, 'hex');
  return Buffer.concat([hashBuffer, transactionCountBuffer, bytesBuffer]);
};

exports.decodeBlockIndexValue = function(buffer) {
  var hashBuffer = buffer.slice(0, 32);
  var transactionLength = buffer.readDoubleBE(32);
  var bytes = buffer.readDoubleBE(40);
  return {
    hash: hashBuffer.toString('hex'),
    transactionLength: transactionLength,
    bytes: bytes
  };
};



module.exports = exports;
