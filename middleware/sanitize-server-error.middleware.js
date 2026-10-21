// Many existing controllers send their own 500 JSON responses. Keep their
// success and client-error contracts while preventing internal messages or
// stacks from reaching the client.
const sanitizeServerError = (req, res, next) => {
  const sendJson = res.json;
  res.json = function (body) {
    if (this.statusCode >= 500) {
      return sendJson.call(this, { success: false, error: 'Internal server error' });
    }
    return sendJson.call(this, body);
  };
  next();
};

module.exports = sanitizeServerError;
