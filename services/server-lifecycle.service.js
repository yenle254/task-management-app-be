function createServerLifecycle({ server, io, health, stopScheduler, stopSockets, disconnectDatabase,
  flushAudit = async () => {}, timeoutMs = 15000, logger, processRef = process }) {
  let shutdownPromise;
  const connections = new Set();
  const trackConnection = socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  };
  server.on('connection', trackConnection);
  const drainKeepAlive = (_req, res) => res.once('finish', () => {
    // An active response may become idle after close() initially reaps idle
    // sockets. Reap again after Node has finished its response bookkeeping.
    if (shutdownPromise) setImmediate(() => server.closeIdleConnections?.());
  });
  server.on('request', drainKeepAlive);

  function shutdown(reason = 'shutdown', exitCode = 0) {
    if (shutdownPromise) return shutdownPromise;
    health.beginShutdown();
    logger.info('Server shutdown started', { reason });
    shutdownPromise = (async () => {
      let forced = false;
      let timer;
      let failed = false;
      const attempt = async (step, operation) => {
        try { await operation(); }
        catch (_) { failed = true; logger.error('Server shutdown step failed', { step }); }
      };
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => {
          forced = true;
          logger.error('Server shutdown deadline exceeded');
          for (const socket of connections) socket.destroy();
          server.closeAllConnections?.();
          resolve(1);
        }, timeoutMs);
      });
      const graceful = (async () => {
        // Stop accepting work immediately, then drain HTTP and background work
        // before closing MongoDB. Socket.IO also closes its shared HTTP server;
        // the independent close callback below waits for active HTTP requests.
        await Promise.all([
          attempt('http', () => new Promise((resolve, reject) => server.close(error => {
            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
            else resolve();
          }))),
          attempt('scheduler', stopScheduler),
          attempt('socket-workers', stopSockets),
          attempt('socket-io', () => io.close()),
        ]);
        if (forced) return 1;
        await attempt('audit', flushAudit);
        if (forced) return 1;
        await attempt('database', disconnectDatabase);
        return failed ? 1 : exitCode;
      })();
      const code = await Promise.race([graceful, deadline]);
      clearTimeout(timer);
      processRef.removeListener('SIGINT', onSigint);
      processRef.removeListener('SIGTERM', onSigterm);
      server.removeListener('connection', trackConnection);
      server.removeListener('request', drainKeepAlive);
      logger.info('Server shutdown completed', { exitCode: code });
      processRef.exit(code);
      return code;
    })();
    return shutdownPromise;
  }

  const onSigint = () => { void shutdown('SIGINT'); };
  const onSigterm = () => { void shutdown('SIGTERM'); };
  // Keep listeners until completion so repeated signals share the same drain.
  processRef.on('SIGINT', onSigint);
  processRef.on('SIGTERM', onSigterm);
  return { shutdown };
}

module.exports = { createServerLifecycle };
