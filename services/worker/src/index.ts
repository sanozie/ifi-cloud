const intervalMs = Number(process.env.WORKER_POLL_MS || 3000);
let timer: any;
let stopping = false;

function tick() {
  if (stopping) return;
  const ts = new Date().toISOString();
  // Do minimal work here; placeholder to be extended later
  console.log(`[worker] alive ${ts}`);
}

function start() {
  console.log('[worker] starting');
  timer = setInterval(tick, intervalMs);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.log('[worker] stopped');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
