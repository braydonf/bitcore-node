'use strict';

var index = require('..');
var async = require('async');
var log = index.log;
log.debug = function() {};

if (process.env.BITCORENODE_ENV !== 'test') {
  log.info('Please set the environment variable BITCORENODE_ENV=test and make sure bindings are compiled for testing');
  process.exit();
}

var chai = require('chai');
var bitcore = require('bitcore-lib');
var rimraf = require('rimraf');
var node;

var should = chai.should();

var index = require('..');
var BitcoreNode = index.Node;
var AddressService = index.services.Address;
var BitcoinService = index.services.Bitcoin;
var DBService = index.services.DB;

describe('Node Functionality', function() {

  var regtest;

  it('will not crash', function(done) {

    this.timeout(30000);

    // Add the regtest network
    bitcore.Networks.remove(bitcore.Networks.testnet);
    bitcore.Networks.add({
      name: 'regtest',
      alias: 'regtest',
      pubkeyhash: 0x6f,
      privatekey: 0xef,
      scripthash: 0xc4,
      xpubkey: 0x043587cf,
      xprivkey: 0x04358394,
      networkMagic: 0xfabfb5da,
      port: 18444,
      dnsSeeds: [ ]
    });
    regtest = bitcore.Networks.get('regtest');

    var datadir = __dirname + '/data';

    rimraf(datadir + '/regtest', function(err) {

      if (err) {
        throw err;
      }

      var configuration = {
        datadir: datadir,
        network: 'regtest',
        services: [
          {
            name: 'db',
            module: DBService,
            config: {}
          },
          {
            name: 'bitcoind',
            module: BitcoinService,
            config: {}
          },
          {
            name: 'address',
            module: AddressService,
            config: {}
          }
        ]
      };

      node = new BitcoreNode(configuration);

      node.on('error', function(err) {
        log.error(err);
      });

      node.on('ready', function() {
        console.log('ready');
      });

      node.start(function() {
        throw new Error('hello');
      });    


    });

  });

});
