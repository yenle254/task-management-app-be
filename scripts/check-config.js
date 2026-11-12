try {
  const { nodeEnv, port, host, trustProxy } = require('../config/runtime.config').loadRuntimeConfig();
  console.log(JSON.stringify({ success: true, node: process.versions.node, environment: nodeEnv, port, host, trustProxy }));
} catch (error) {
  console.error(`Startup configuration invalid: ${error.message}`);
  process.exitCode = 1;
}
