'use strict';

var lmdb = require('node-lmdb/build/Release/node-lmdb');
var constants = require('./constants');

function ChainReader(options) {
  this.dataPath = options.dataPath;

  if (options.env) {
    this.env = options.env;
    // TODO assertions
    this.addressBalanceDbi = options.addressBalanceDbi;
    this.outputsDbi = options.outputsDbi;
    this.addressTransactionsDbi = options.addressTransactionsDbi;
    this.blocksDbi = options.blocksDbi;
  } else {
    this.env = new lmdb.Env();
    this.env.open({
      path: this.dataPath,
      maxDbs: 10,
      mapSize: 268435456 * 4096,
      noMetaSync: true,
      noSync: true
    });
    this.addressBalanceDbi = this.env.openDbi({
      name: 'addressBalance'
    });
    this.outputsDbi = this.env.openDbi({
      name: 'outputs'
    });
    this.addressTransactionsDbi = this.env.openDbi({
      name: 'addressTransactions'
    });
  }
  this.txn = this.env.beginTxn({readOnly: true});
}

ChainReader.prototype.getBalance = function(address) {
  var key = address.hashBuffer.toString('binary') + constants.HASH_TYPES_MAP[address.type].toString('binary');
  this.addressBalanceDbi();
  var balanceValue = this.txn.getBinary(this.addressBalanceDbi, key);
  if (!balanceValue) {
    return;
  }
  var balance = balanceValue.readDoubleBE();
  return balance;
};

ChainReader.prototype.getAddressHistory = function() {
  // get value from address sum database -> slice by range of txids -> query transaction details
};

ChainReader.prototype.getAddressSummary = function() {
  // get value from address sum database -> read balance -> read txids (recieved/spent/change?)
};

ChainReader.prototype.getUnspentOutputs = function() {
  // get value from address sum database -> extract txids -> check if txout spent -> query transaction details
};
