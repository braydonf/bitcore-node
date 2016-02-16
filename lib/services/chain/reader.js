'use strict';

function ChainReader() {
  
}


ChainReader.prototype.getBalance = function() {
  // get value from address sum database and read the balance
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
