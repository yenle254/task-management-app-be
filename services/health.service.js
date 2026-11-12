function createHealthService({ connection, timeoutMs = 1000 }) {
  let started = false;
  let stopping = false;
  let probe;

  const available = () => started && !stopping && connection.readyState === 1 && Boolean(connection.db);

  async function isReady() {
    if (!available()) return false;
    if (!probe) {
      const controller = new AbortController();
      const current = {};
      probe = current;
      let timer;
      const timeout = new Promise(resolve => {
        current.cancel = () => { clearTimeout(timer); resolve(false); controller.abort(); };
        timer = setTimeout(current.cancel, timeoutMs);
      });
      const operation = Promise.resolve().then(() => connection.db.command(
        { ping: 1 }, { maxTimeMS: timeoutMs, signal: controller.signal }
      )).then(result => result?.ok === 1, () => false);
      current.result = Promise.race([operation, timeout]);
      // Keep one probe until the underlying operation settles, including after a
      // timeout. Repeated health requests cannot pile up hung database commands.
      operation.then(() => {
        clearTimeout(timer);
        if (probe === current) probe = undefined;
      });
    }
    const healthy = await probe.result;
    // Shutdown/disconnection can happen while the ping is in flight.
    return healthy && available();
  }

  return {
    isReady,
    markStarted() { if (!stopping) started = true; },
    beginShutdown() { stopping = true; probe?.cancel(); },
    isStopping: () => stopping,
  };
}

module.exports = { createHealthService };
