import { spawn } from 'node:child_process';
// Only the genesis of a brand-new disposable chain is historical. Existing
// blocks, user credentials, and authenticated passport dates are never rewritten.
const timestamp = Math.floor(Date.now() / 1000) - 7200;
const child = spawn('/opt/foundry/bin/anvil', [
  '--silent', '--host', '0.0.0.0', '--port', '8545', '--chain-id', '31337',
  '--timestamp', String(timestamp),
], { stdio: 'inherit', env: { ...process.env, LD_PRELOAD: '' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
