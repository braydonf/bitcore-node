'use strict';

var bitcore = require('bitcore-lib');
var encoding = require('./encoding');

function readBlock(blockData, height) {
  /* jshint maxstatements: 50 */

  var outputSpents = {};
  var addressOutputs = {};

  var blockBuffer = new Buffer(blockData, 'binary');
  var block = bitcore.Block.fromBuffer(blockBuffer);
  var blockBytes = blockBuffer.length;

  var blockHash = block.hash;
  var heightBuffer = new Buffer(new Array(4));
  heightBuffer.writeUInt32BE(height);

  var transactions = block.transactions;
  var transactionsLength = transactions.length;

  for (var t = 0; t < transactionsLength; t++) {
    var tx = transactions[t];

    var txHashBuffer = new Buffer(Array.prototype.reverse.call(new Uint16Array(tx._getHash())));

    if (!tx.isCoinbase()) {
      for (var inputIndex = 0; inputIndex < tx.inputs.length; inputIndex++) {
        var input = tx.inputs[inputIndex];
        var inputKey = input.prevTxId.toString('binary') + input.outputIndex.toString();
        var inputIndexBuffer = new Buffer(new Array(4));
        inputIndexBuffer.writeUInt32BE(inputIndex);
        var inputValue = Buffer.concat([txHashBuffer, inputIndexBuffer, heightBuffer]);

        outputSpents[inputKey] = inputValue.toString('binary');
      }
    }

    for (var outputIndex = 0; outputIndex < tx.outputs.length; outputIndex++) {
      var output = tx.outputs[outputIndex];

      var outputScript = output.script;
      if (!outputScript) {
        continue;
      }
      var addressInfo = encoding.extractAddressInfoFromScript(outputScript);
      if (!addressInfo) {
        continue;
      }

      var outputKey = addressInfo.hashBuffer.toString('binary') + addressInfo.hashTypeBuffer.toString('binary');

      var outputSatoshisBuffer = new Buffer(new Array(8));
      outputSatoshisBuffer.writeDoubleBE(output.satoshis);
      var outputIndexBuffer = new Buffer(new Array(4));
      outputIndexBuffer.writeUInt32BE(outputIndex);

      var outputValue = Buffer.concat([
        heightBuffer,
        txHashBuffer,
        outputIndexBuffer,
        outputSatoshisBuffer
      ]);

      if (addressOutputs[outputKey]) {
        addressOutputs[outputKey].push(outputValue.toString('binary'));
      } else {
        addressOutputs[outputKey] = [outputValue.toString('binary')];
      }

    }

  }

  var blockValue = encoding.encodeBlockIndexValue(blockHash, transactionsLength, blockBytes);

  return {
    outputSpents: outputSpents,
    addressOutputs: addressOutputs,
    timestamp: block.header.timestamp,
    meta: blockValue.toString('binary')
  };

}

process.on('message', function(message) {
  process.send(readBlock(message.block, message.height));
});
