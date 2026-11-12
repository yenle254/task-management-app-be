// Node is already present in the image; no curl or other probe binary is needed.
const http = require('node:http');
const port = Number(process.env.PORT || 3000);
const request = http.get({ hostname: '127.0.0.1', port, path: '/health/live' }, response => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});
const timer = setTimeout(() => request.destroy(new Error('Health check timeout')), 2000);
request.on('error', () => { clearTimeout(timer); process.exit(1); });
