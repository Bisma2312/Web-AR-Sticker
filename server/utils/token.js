const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token, pepper = process.env.TOKEN_PEPPER || '') {
  return crypto.createHash('sha256').update(`${token}${pepper}`).digest('hex');
}

function randomUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older Node
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );
}

module.exports = { randomToken, hashToken, randomUUID };

