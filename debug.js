var util = require('util');

var debug;
if(process.env.NODE_DEBUG && /(minecraft-protocol-forge|mc-proto-forge)/.test(process.env.NODE_DEBUG)) {
  var pid = process.pid;
  debug = function(x) {
    // if console is not set up yet, then skip this.
    if(!console.error)
      return;
    console.error('MC-PROTO-FORGE: %d', pid,
      util.format.apply(util, arguments).slice(0, 500));
  };
} else {
  debug = function() {
  };
}

module.exports = debug;
