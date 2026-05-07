// Polyfill WebCrypto for Node 18 jest environment.
if (!global.crypto) {
  global.crypto = require("node:crypto").webcrypto;
}
