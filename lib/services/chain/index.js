'use strict';

var fs = require('fs');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

var bitcore = require('bitcore-lib');
var BufferUtil = bitcore.util.buffer;
var Block = bitcore.Block;
var Networks = bitcore.Networks;
var $ = bitcore.util.preconditions;
var async = require('async');
var mkdirp = require('mkdirp');
var lmdb = require('node-lmdb/build/Release/node-lmdb')
;
var index = require('../../');
var errors = index.errors;
var log = index.log;
var Transaction = require('../../transaction');
var encoding = require('./encoding');
var constants = require('./constants');

function Chain(options) {
  EventEmitter.call(this);

  this.node = options.node;

  this.dbOpen = false;
  this.txn = false;
  this.env = false;
  this.pendingBlocks = 0;
  this.lastCommit = new Date();

  this.version = 1;

  this.tip = null;
  this.genesis = null;
  this.network = this.node.network;
  this._setDataPath();

  this.maxTransactionLimit = options.maxTransactionLimit || constants.MAX_TRANSACTION_LIMIT;
  this.retryInterval = 60000;

  this.subscriptions = {
    transaction: [],
    block: []
  };
}

inherits(Chain, EventEmitter);

Chain.dependencies = ['bitcoind'];

Chain.prototype.start = function(callback) {
  var self = this;

  if (!fs.existsSync(this.dataPath)) {
    mkdirp.sync(this.dataPath);
  }

  this.genesisBytes = this.node.services.bitcoind.genesisBuffer.length;
  this.genesis = Block.fromBuffer(this.node.services.bitcoind.genesisBuffer);

  self.env = new lmdb.Env();
  self.env.open({
    path: this.dataPath,
    maxDbs: 10,
    mapSize: 268435456 * 4096,
    noMetaSync: true,
    noSync: true
  });
  self.addressOutputsDbi = self.env.openDbi({
    name: 'addressOutputs',
    create: true
  });
  self.addressSumDbi = self.env.openDbi({
    name: 'addressSum',
    create: true,
    dupSort: true,
    dupFixed: true
  });
  self.blocksDbi = self.env.openDbi({
    name: 'blocks',
    create: true,
    keyIsUint32: true
  });
  self.dbOpen = true;

  this.once('ready', function() {
    log.info('Bitcoin Database Ready');

    // Notify that there is a new tip
    self.node.services.bitcoind.on('tip', function(height) {
      if(!self.node.stopping) {
        self.sync();
      }
    });
  });

  self.loadTip(function(err) {
    if (err) {
      return callback(err);
    }

    self.sync();
    self.emit('ready');
    setImmediate(callback);
  });

};

/**
 * This function will set `this.dataPath` based on `this.node.network`.
 * @private
 */
Chain.prototype._setDataPath = function() {
  $.checkState(this.node.datadir, 'Node is expected to have a "datadir" property');
  if (this.node.network === Networks.livenet) {
    this.dataPath = this.node.datadir + '/bitcore-chainstate';
  } else if (this.node.network === Networks.testnet) {
    if (this.node.network.regtestEnabled) {
      this.dataPath = this.node.datadir + '/regtest/bitcore-chainstate';
    } else {
      this.dataPath = this.node.datadir + '/testnet3/bitcore-chainstate';
    }
  } else {
    throw new Error('Unknown network: ' + this.network);
  }
};

Chain.prototype.stop = function(callback) {
  var self = this;

  // Wait until syncing stops and all db operations are completed before closing leveldb
  async.whilst(function() {
    return self.bitcoindSyncing;
  }, function(next) {
    setTimeout(next, 10);
  }, function() {

    if (self.dbOpen) {
      self.addressOutputsDbi.close();
      self.addressSumDbi.close();
      self.env.close();
      setImmediate(callback);
    } else {
      setImmediate(callback);
    }

  });

};

Chain.prototype.getAPIMethods = function() {
  var methods = [
    ['getBlock', this, this.getBlock, 1],
    ['getBlockInfoByTimestamp', this, this.getBlockHashesByTimestamp, 2],
    ['getTransaction', this, this.getTransaction, 2],
    ['getTransactionWithBlockInfo', this, this.getTransactionWithBlockInfo, 2],
    ['sendTransaction', this, this.sendTransaction, 1],
    ['estimateFee', this, this.estimateFee, 1],
    ['getBalance', this, this.getBalance, 2],
    ['getUnspentOutputs', this, this.getUnspentOutputs, 2],
    ['getInputForOutput', this, this.getInputForOutput, 2],
    ['isSpent', this, this.isSpent, 2],
    ['getAddressHistory', this, this.getAddressHistory, 2],
    ['getAddressSummary', this, this.getAddressSummary, 1]
  ];
  return methods;
};

/**
 * Called by the Bus to determine the available events.
 */
Chain.prototype.getPublishEvents = function() {
  return [
    {
      name: 'chain/transaction',
      scope: this,
      subscribe: this.subscribe.bind(this, 'transaction'),
      unsubscribe: this.unsubscribe.bind(this, 'transaction')
    },
    {
      name: 'chain/block',
      scope: this,
      subscribe: this.subscribe.bind(this, 'block'),
      unsubscribe: this.unsubscribe.bind(this, 'block')
    }
  ];
};

Chain.prototype.subscribe = function(name, emitter) {
  this.subscriptions[name].push(emitter);
};

Chain.prototype.unsubscribe = function(name, emitter) {
  var index = this.subscriptions[name].indexOf(emitter);
  if (index > -1) {
    this.subscriptions[name].splice(index, 1);
  }
};

/**
 * Will give information about the database from bitcoin.
 * @param {Function} callback
 */
Chain.prototype.getInfo = function(callback) {
  var self = this;
  setImmediate(function() {
    var info = self.node.bitcoind.getInfo();
    callback(null, info);
  });
};

/**
 * Will get a block from bitcoind and give a Bitcore Block
 * @param {String|Number} hash - A block hash or block height
 */
Chain.prototype.getBlock = function(hash, callback) {
  this.node.services.bitcoind.getBlock(hash, function(err, blockBuffer) {
    if (err) {
      return callback(err);
    }
    callback(null, Block.fromBuffer(blockBuffer));
  });
};

/**
 * Will give a Bitcore Transaction from bitcoind by txid
 * @param {String} txid - A transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Chain.prototype.getTransaction = function(txid, queryMempool, callback) {
  this.node.services.bitcoind.getTransaction(txid, queryMempool, function(err, txBuffer) {
    if (err) {
      return callback(err);
    }
    if (!txBuffer) {
      return callback(new errors.Transaction.NotFound());
    }

    callback(null, Transaction().fromBuffer(txBuffer));
  });
};

/**
 * Will give a Bitcore Transaction and populated information about the block included.
 * @param {String} txid - A transaction hash
 * @param {Boolean} queryMempool - Include the mempool
 * @param {Function} callback
 */
Chain.prototype.getTransactionWithBlockInfo = function(txid, queryMempool, callback) {
  this.node.services.bitcoind.getTransactionWithBlockInfo(txid, queryMempool, function(err, obj) {
    if (err) {
      return callback(err);
    }

    var tx = Transaction().fromBuffer(obj.buffer);
    tx.__blockHash = obj.blockHash;
    tx.__height = obj.height;
    tx.__timestamp = obj.timestamp;

    callback(null, tx);
  });
};

/**
 * Will send a transaction to the Bitcoin network.
 * @param {Transaction} tx - An instance of a Bitcore Transaction
 * @param {Function} callback
 */
Chain.prototype.sendTransaction = function(tx, callback) {
  var txString;
  if (tx instanceof Transaction) {
    txString = tx.serialize();
  } else {
    txString = tx;
  }

  try {
    var txid = this.node.services.bitcoind.sendTransaction(txString);
    return callback(null, txid);
  } catch(err) {
    return callback(err);
  }
};

/**
 * Will estimate fees for a transaction and give a result in
 * satoshis per kilobyte. Similar to the bitcoind estimateFee method.
 * @param {Number} blocks - The number of blocks for the transaction to be included.
 * @param {Function} callback
 */
Chain.prototype.estimateFee = function(blocks, callback) {
  var self = this;
  setImmediate(function() {
    callback(null, self.node.services.bitcoind.estimateFee(blocks));
  });
};

/**
 * Will give the previous hash for a block.
 * @param {String} blockHash
 * @param {Function} callback
 */
Chain.prototype.getPrevHash = function(blockHash, callback) {
  var blockIndex = this.node.services.bitcoind.getBlockIndex(blockHash);
  setImmediate(function() {
    if (blockIndex) {
      callback(null, blockIndex.prevHash);
    } else {
      callback(new Error('Could not get prevHash, block not found'));
    }
  });
};

/**
 * Get block hashes between two timestamps
 * @param {Number} high - high timestamp, in seconds, inclusive
 * @param {Number} low - low timestamp, in seconds, inclusive
 * @param {Function} callback
 */
Chain.prototype.getBlockInfoByTimestamp = function(high, low, callback) {
  var self = this;
  var blocks = [];
  var lowKey;
  var highKey;

  try {
    lowKey = encoding.encodeBlockIndexKey(low);
    highKey = encoding.encodeBlockIndexKey(high);
  } catch(e) {
    return callback(e);
  }

  // TODO use cursor to interate through key ranges
  callback();
};

/**
 * Connects a block to the database and add indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
Chain.prototype.connectBlock = function(block, blockBytes, callback) {
  log.debug('DB handling new chain block');
  this.runBlockHandler(block, blockBytes, true, callback);
};

/**
 * Disconnects a block from the database and removes indexes
 * @param {Block} block - The bitcore block
 * @param {Function} callback
 */
Chain.prototype.disconnectBlock = function(block, blockBytes, callback) {
  log.debug('DB removing chain block');
  this.runBlockHandler(block, blockBytes, false, callback);
};

/**
 * Will collect all database operations for a block from other services that implement
 * `blockHandler` methods and then save operations to the database.
 * @param {Block} block - The bitcore block
 * @param {Boolean} add - If the block is being added/connected or removed/disconnected
 * @param {Function} callback
 */
Chain.prototype.runBlockHandler = function(block, blockBytes, add, callback) {
  var self = this;

  // TODO: If not currently syncing many blocks, create a backup with the block
  // for the purposes of reorgs

  // Notify block subscribers
  for (var i = 0; i < this.subscriptions.block.length; i++) {
    this.subscriptions.block[i].emit('chain/block', block.hash);
  }

  self.blockHandler(block, blockBytes, add, function(err) {
    if (err) {
      return callback(err);
    }
    if (new Date() - self.lastCommit > constants.COMMIT_INTERVAL || self.pendingBlocks > 200) {
      self.txn.commit();
      self.env.sync(function(err){
        self.lastCommit = new Date();
        if (err) {
          return callback(err);
        }
        self.txn = false;
        self.pendingBlocks = 0;
        callback();
      });
    } else {
      callback();
    }
  });

};

Chain.prototype.blockHandler = function(block, blockBytes, add, nextBlock) {
  var self = this;

  if (!self.txn) {
    self.txn = self.env.beginTxn();
  }

  var blockHash = block.hash;
  var blockHashBuffer = new Buffer(blockHash, 'hex');

  var transactions = block.transactions;
  var transactionsLength = transactions.length;

  for (var t = 0; t < transactionsLength; t++) {
    var tx = transactions[t];

    var txHash = tx.hash;
    var txHashBuffer = new Buffer(txHash, 'hex');
    var txHashString = txHashBuffer.toString('binary');

    var deltas = {};

    if (!tx.isCoinbase()) {
      for (var inputIndex = 0; inputIndex < tx.inputs.length; inputIndex++) {
        var input = tx.inputs[inputIndex];

        var prevTxId = input.prevTxId.toString('binary');
        var prevOutputKey = prevTxId + input.outputIndex;
        var prevOutputValue = self.txn.getBinary(self.addressOutputsDbi, prevOutputKey);

        if (prevOutputValue) {
          var prevOutputSatoshis = prevOutputValue.readDoubleBE();
          var hashBuffer = prevOutputValue.slice(8, 28);
          var hashTypeBuffer = prevOutputValue.slice(28, 29);

          var key = hashBuffer.toString('binary') + hashTypeBuffer.toString('binary');
          var balanceDiff = add ? prevOutputSatoshis * -1 : prevOutputSatoshis;
          if (deltas[key]) {
            deltas[key] += balanceDiff;
          } else {
            deltas[key] = balanceDiff;
          }
        }
      }
    }

    for (var outputIndex = 0; outputIndex < tx.outputs.length; outputIndex++) {
      var output = tx.outputs[outputIndex];

      var outputScript = output.script;
      if (!outputScript) {
        continue;
      }
      var outputAddressInfo = encoding.extractAddressInfoFromScript(outputScript, self.node.network);
      if (!outputAddressInfo) {
        continue;
      }

      var outputKey = txHashString + outputIndex;
      var outputSatoshis = new Buffer(new Array(8));
      outputSatoshis.writeDoubleBE(output.satoshis);
      var outputValue = Buffer.concat([
        outputSatoshis,
        outputAddressInfo.hashBuffer,
        outputAddressInfo.hashTypeBuffer,
        blockHashBuffer
      ]);

      if (add) {
        self.txn.putBinary(self.addressOutputsDbi, outputKey, outputValue);
      } else {
        self.txn.del(self.addressOutputsDbi, outputKey);
      }

      var outKey = outputAddressInfo.hashBuffer.toString('binary') +
        outputAddressInfo.hashTypeBuffer.toString('binary');

      var outBalanceDiff = add ? output.satoshis : output.satoshis * -1;
      if (deltas[outKey]) {
        deltas[outKey] += outBalanceDiff;
      } else {
        deltas[outKey] = outBalanceDiff;
      }
    }

    // Update address balances
    for (var addressKey in deltas) {
      var addressSum = self.txn.getBinary(self.addressSumDbi, addressKey);

      if (addressSum) {
        var balance = addressSum.readDoubleBE() + deltas[addressKey];
        addressSum.writeDoubleBE(balance);
      } else {
        addressSum = new Buffer(new Array(8));
        addressSum.writeDoubleBE(deltas[addressKey]);
      }

      self.txn.putBinary(self.addressSumDbi, addressKey, addressSum);
    }

  }

  // Update tip
  var tipHash = add ? new Buffer(block.hash, 'hex') : BufferUtil.reverse(block.header.prevHash);
  self.txn.putBinary(self.blocksDbi, constants.TIP_KEY, tipHash);

  // Update block index
  var blockValue = encoding.encodeBlockIndexValue(blockHash, transactionsLength, blockBytes);
  if (add) {
    self.txn.putBinary(self.blocksDbi, block.header.timestamp, blockValue);
  } else {
    self.txn.del(self.blocksDbi, block.header.timestamp);
  }

  self.pendingBlocks++;

  setImmediate(function() {
    nextBlock();
  });

};

Chain.prototype.loadTip = function(callback) {
  var self = this;

  var txn = self.env.beginTxn();
  var tipData = txn.getBinary(self.blocksDbi, constants.TIP_KEY);
  txn.abort();

  if (!tipData) {
    self.tip = self.genesis;
    self.tip.__height = 0;
    self.connectBlock(self.genesis, self.genesisBytes, function(err) {
      if(err) {
        return callback(err);
      }
      self.emit('addblock', self.genesis);
      callback();
    });
    return;
  }

  var hash = tipData.toString('hex');

  var times = 0;
  async.retry({times: 3, interval: self.retryInterval}, function(done) {
    self.getBlock(hash, function(err, tip) {
      if(err) {
        times++;
        log.warn('Bitcoind does not have our tip (' + hash + '). Bitcoind may have crashed and needs to catch up.');
        if(times < 3) {
          log.warn('Retrying in ' + (self.retryInterval / 1000) + ' seconds.');
        }
        return done(err);
      }
      done(null, tip);
    });
  }, function(err, tip) {
    if(err) {
      log.warn('Giving up after 3 tries. Please report this bug to https://github.com/bitpay/bitcore-node/issues');
      log.warn('Please reindex your database.');
      return callback(err);
    }

    self.tip = tip;
    var blockIndex = self.node.services.bitcoind.getBlockIndex(self.tip.hash);
    if(!blockIndex) {
      return callback(new Error('Could not get height for tip.'));
    }
    self.tip.__height = blockIndex.height;
    callback();
  });

};


/**
 * This function will find the common ancestor between the current chain and a forked block,
 * by moving backwards on both chains until there is a meeting point.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
Chain.prototype.findCommonAncestor = function(block, done) {

  var self = this;

  var mainPosition = self.tip.hash;
  var forkPosition = block.hash;

  var mainHashesMap = {};
  var forkHashesMap = {};

  mainHashesMap[mainPosition] = true;
  forkHashesMap[forkPosition] = true;

  var commonAncestor = null;

  async.whilst(
    function() {
      return !commonAncestor;
    },
    function(next) {

      if(mainPosition) {
        var mainBlockIndex = self.node.services.bitcoind.getBlockIndex(mainPosition);
        if(mainBlockIndex && mainBlockIndex.prevHash) {
          mainHashesMap[mainBlockIndex.prevHash] = true;
          mainPosition = mainBlockIndex.prevHash;
        } else {
          mainPosition = null;
        }
      }

      if(forkPosition) {
        var forkBlockIndex = self.node.services.bitcoind.getBlockIndex(forkPosition);
        if(forkBlockIndex && forkBlockIndex.prevHash) {
          forkHashesMap[forkBlockIndex.prevHash] = true;
          forkPosition = forkBlockIndex.prevHash;
        } else {
          forkPosition = null;
        }
      }

      if(forkPosition && mainHashesMap[forkPosition]) {
        commonAncestor = forkPosition;
      }

      if(mainPosition && forkHashesMap[mainPosition]) {
        commonAncestor = mainPosition;
      }

      if(!mainPosition && !forkPosition) {
        return next(new Error('Unknown common ancestor'));
      }

      setImmediate(next);
    },
    function(err) {
      done(err, commonAncestor);
    }
  );
};

/**
 * This function will attempt to rewind the chain to the common ancestor
 * between the current chain and a forked block.
 * @param {Block} block - The new tip that forks the current chain.
 * @param {Function} done - A callback function that is called when complete.
 */
Chain.prototype.syncRewind = function(block, done) {

  var self = this;

  self.findCommonAncestor(block, function(err, ancestorHash) {
    if (err) {
      return done(err);
    }
    log.warn('Reorg common ancestor found:', ancestorHash);
    // Rewind the chain to the common ancestor
    async.whilst(
      function() {
        // Wait until the tip equals the ancestor hash
        return self.tip.hash !== ancestorHash;
      },
      function(removeDone) {

        var tip = self.tip;

        // TODO: expose prevHash as a string from bitcore
        var prevHash = BufferUtil.reverse(tip.header.prevHash).toString('hex');

        self.getBlock(prevHash, function(err, previousTip) {
          if (err) {
            removeDone(err);
          }

          // Undo the related indexes for this block
          var tipBytes = tip.toBuffer().length;
          self.disconnectBlock(tip, tipBytes, function(err) {
            if (err) {
              return removeDone(err);
            }

            // Set the new tip
            previousTip.__height = self.tip.__height - 1;
            self.tip = previousTip;
            self.emit('removeblock', tip);
            removeDone();
          });

        });

      }, done
    );
  });
};

/**
 * This function will synchronize additional indexes for the chain based on
 * the current active chain in the bitcoin daemon. In the event that there is
 * a reorganization in the daemon, the chain will rewind to the last common
 * ancestor and then resume syncing.
 */
Chain.prototype.sync = function() {
  var self = this;

  if (self.bitcoindSyncing || self.node.stopping || !self.tip) {
    return;
  }

  self.bitcoindSyncing = true;

  var height;

  async.whilst(function() {
    height = self.tip.__height;
    return height < self.node.services.bitcoind.height && !self.node.stopping;
  }, function(done) {
    self.node.services.bitcoind.getBlock(height + 1, function(err, blockBuffer) {
      if (err) {
        return done(err);
      }

      var blockBytes = blockBuffer.length;
      var block = Block.fromBuffer(blockBuffer);

      // TODO: expose prevHash as a string from bitcore
      var prevHash = BufferUtil.reverse(block.header.prevHash).toString('hex');

      if (prevHash === self.tip.hash) {

        // This block appends to the current chain tip and we can
        // immediately add it to the chain and create indexes.

        // Populate height
        block.__height = self.tip.__height + 1;

        // Create indexes
        self.connectBlock(block, blockBytes, function(err) {
          if (err) {
            return done(err);
          }
          self.tip = block;
          log.debug('Chain added block to main chain');
          self.emit('addblock', block);
          setImmediate(done);
        });
      } else {
        // This block doesn't progress the current tip, so we'll attempt
        // to rewind the chain to the common ancestor of the block and
        // then we can resume syncing.
        log.warn('Beginning reorg! Current tip: ' + self.tip.hash + '; New tip: ' + block.hash);
        self.syncRewind(block, function(err) {
          if(err) {
            return done(err);
          }

          log.warn('Reorg complete. New tip is ' + self.tip.hash);
          done();
        });
      }
    });
  }, function(err) {
    if (err) {
      Error.captureStackTrace(err);
      return self.node.emit('error', err);
    }

    if(self.node.stopping) {
      self.bitcoindSyncing = false;
      return;
    }

    if (self.node.services.bitcoind.isSynced()) {
      self.bitcoindSyncing = false;
      self.node.emit('synced');
    } else {
      self.bitcoindSyncing = false;
    }

  });

};

module.exports = Chain;
