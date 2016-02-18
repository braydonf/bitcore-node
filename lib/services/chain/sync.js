'use strict';

var spawn = require('child_process').spawn;
var block = require('../../../test/data/livenet-345003.json');
var blockBuffer = new Buffer(block, 'hex');

var child = spawn('node', ['./blockreader.js'], { stdio: [0, 1, 2, 'ipc']});

child.on('message', function(message) {
  console.log(message);
});

child.send({block: blockBuffer.toString('binary')});
