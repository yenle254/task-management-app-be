/**
 * Request ID middleware
 * Generates a server-side UUID for every incoming HTTP request.
 * Attaches it to req.requestId and returns it in the X-Request-Id response header.
 * Always generates a fresh server-side ID; does not trust arbitrary client values.
 */
const { randomUUID } = require('crypto');

const REQUEST_ID_HEADER = 'x-request-id';
const RESPONSE_HEADER = 'X-Request-Id';

const requestId = (req, res, next) => {
  // Always generate a server-side ID to avoid spoofing / injection from clients
  const id = randomUUID();
  req.requestId = id;
  res.setHeader(RESPONSE_HEADER, id);
  next();
};

module.exports = requestId;
module.exports.REQUEST_ID_HEADER = REQUEST_ID_HEADER;
module.exports.RESPONSE_HEADER = RESPONSE_HEADER;
