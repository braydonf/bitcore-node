'use strict';

var exports = {};

exports.HASH_TYPES = {
  PUBKEY: new Buffer('01', 'hex'),
  REDEEMSCRIPT: new Buffer('02', 'hex')
};

exports.HASH_TYPES_MAP = {
  'pubkeyhash': exports.HASH_TYPES.PUBKEY,
  'scripthash': exports.HASH_TYPES.REDEEMSCRIPT
};

// The key used in blocks database for the tip
exports.TIP_KEY = 0;

// The time between blocks before commiting to the database
exports.COMMIT_INTERVAL = 30 * 1000;

// This will enable/disable calculating balances for addresses at each block
// it needs to be configured before syncronization, or will require a reindex
exports.ENABLE_BALANCE_INDEX = false;

// The maximum number of transactions to query at once
// Used for populating previous inputs
exports.MAX_TRANSACTION_LIMIT = 5;

module.exports = exports;

