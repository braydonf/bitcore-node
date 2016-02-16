'use strict';

var exports = {};

exports.HASH_TYPES = {
  PUBKEY: new Buffer('01', 'hex'),
  REDEEMSCRIPT: new Buffer('02', 'hex')
};

// The key used in blocks database for the tip
exports.TIP_KEY = 0;

// The time between blocks before commiting to the database
exports.COMMIT_INTERVAL = 60 * 1000;

// The maximum number of transactions to query at once
// Used for populating previous inputs
exports.MAX_TRANSACTION_LIMIT = 5;

module.exports = exports;

