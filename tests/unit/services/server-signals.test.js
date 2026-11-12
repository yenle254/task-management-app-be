const { spawn } = require('node:child_process');
const path = require('node:path');

test.each(['SIGINT', 'SIGTERM'])('isolated server exits cleanly after %s and closes database first', async signal => {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../fixtures/lifecycle-process.fixture.cjs')], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages = [];
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, receivedSignal) => resolve({ code, signal: receivedSignal }));
  });
  const listening = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => { messages.push(message.event); if (message.event === 'listening') resolve(message.port); });
    child.once('exit', () => reject(new Error('Fixture exited before listening')));
  });
  try {
    const port = await listening;
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(response.status).toBe(200); await response.json();
    if (process.platform === 'win32') child.send({ signal });
    else child.kill(signal);
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(messages).toEqual(['listening', 'database-closed']);
    expect(stderr).toBe('');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
