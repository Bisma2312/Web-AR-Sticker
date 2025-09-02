// Vercel Serverless Function entrypoint that mounts the Express app
// defined in server/index.js. This catches all /api/* routes.

const app = require('../server/index.js');

module.exports = app;

