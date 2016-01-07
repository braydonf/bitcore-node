'use strict';

var ReadableStream = require('stream').Readable;
var inherits = require('util').inherits;

function CombinedStream(options) {
  ReadableStream.call(this, {
    objectMode: true
  });

  this._inputStream = options.inputStream;
  this._outputStream = options.outputStream;

  // This holds a collection of combined inputs and outputs
  // grouped into the matching block heights.
  this._blocks = {};

  this._inputCurrentHeight = 0;
  this._outputCurrentHeight = 0;
  this._inputFinishedHeights = [];
  this._outputFinishedHeights = [];
  this._inputEnded = false;
  this._outputEnded = false;

  this._listenStreamEvents();
}

inherits(CombinedStream, ReadableStream);

CombinedStream.prototype._listenStreamEvents = function() {
  var self = this;

  // TODO: Control flow between the two to be more at a similar height?

  self._outputStream.on('data', function(output) {
    self._addToBlock(output);
    if (output.height > self._outputCurrentHeight) {
      self._outputFinishedHeights.push(output.height);
      self._maybePushBlock();
    }
    self._outputCurrentHeight = output.height;
  });

  self._inputStream.on('data', function(input) {
    self._addToBlock(input);
    if (input.height > self._inputCurrentHeight) {
      self._inputFinishedHeights.push(input.height);
      self._maybePushBlock();
    }
    self._inputCurrentHeight = input.height;
  });

  self._inputStream.on('error', function(err) {
    self.emit('error', err);
    self.push(null);
  });

  self._outputStream.on('error', function(err) {
    self.emit('error', err);
    self.push(null);
  });

  self._outputStream.on('end', function() {
    self._outputFinishedHeights.push(self._outputCurrentHeight);
    self._outputEnded = true;
    setImmediate(function() {
      self._maybeEndStream();
    });
  });

  self._inputStream.on('end', function() {
    self._inputFinishedHeights.push(self._inputCurrentHeight);
    self._inputEnded = true;
    setImmediate(function() {
      self._maybeEndStream();
    });
  });

};

CombinedStream.prototype._read = function() {
  this._inputStream.resume();
  this._outputStream.resume();
};

CombinedStream.prototype._addToBlock = function(data) {
  if (!this._blocks[data.height]) {
    this._blocks[data.height] = [];
  }
  this._blocks[data.height].push(data);
};

CombinedStream.prototype._maybeEndStream = function() {
  if (this._inputEnded && this._outputEnded) {
    this._pushRemainingBlocks();
    this.push(null);
  }
};

CombinedStream.prototype._pushRemainingBlocks = function() {
  var keys = Object.keys(this._blocks);
  for (var i = 0; i < keys.length; i++) {
    var block = this._blocks[keys[i]];
    this.push(block);
    delete this._blocks[keys[i]];
  }
};

CombinedStream.prototype._maybePushBlock = function() {
  if (!this._inputFinishedHeights[0] || !this._outputFinishedHeights[0]) {
    return;
  }

  var inputFinished = this._inputFinishedHeights[0];
  var outputFinished = this._outputFinishedHeights[0];
  var bothFinished;

  if (inputFinished === outputFinished) {
    bothFinished = inputFinished;
    this._inputFinishedHeights.shift();
    this._outputFinishedHeights.shift();
  } else if (inputFinished <= outputFinished) {
    bothFinished = inputFinished;
    this._inputFinishedHeights.shift();
  } else if (outputFinished <= inputFinished) {
    bothFinished = outputFinished;
    this._outputFinishedHeights.shift();
  }

  // TODO, always make sure to be using the lowest block height first

  if (bothFinished) {
    var block = this._blocks[bothFinished];
    this.push(block);
    delete this._blocks[bothFinished];
  }
};

module.exports = CombinedStream;
