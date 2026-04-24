// src/queue/worker.js — concurrency-loop die jobs claimt en adapters uitvoert.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { runProcess } = require('../util/process-runner');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function startWorkerPool({
  queue,
  repo,
  adapters,
  logger,
  downloadRoot,
  concurrency = 2,
  pollMs = 1000,
}) {
  const byName = new Map(adapters.map((a) => [a.name, a]));
  const workerId = `w-${crypto.randomBytes(3).toString('hex')}`;
  let stopping = false;
  const active = new Set();

  async function runOne(job) {
    const workdir = path.join(downloadRoot, String(job.id));
    await fs.mkdir(workdir, { recursive: true });

    const adapter = byName.get(job.adapter);
    if (!adapter) {
      await repo.appendLog(job.id, 'error', `Onbekende adapter: ${job.adapter}`);
      await queue.fail(job.id, `Onbekende adapter: ${job.adapter}`);
      return;
    }

    const planned = adapter.plan(job.url, { ...job.options, cwd: workdir });
    await repo.appendLog(job.id, 'info', `start ${adapter.name}: ${planned.cmd} ${planned.args.join(' ')}`);
    logger.info('job.start', { job: job.id, adapter: adapter.name });

    let lastReported = -1;
    const proc = runProcess(planned);
    proc.on('line', async ({ stream, line }) => {
      const prog = adapter.parseProgress(line);
      if (prog && typeof prog.pct === 'number') {
        const pct = Math.max(0, Math.min(100, prog.pct));
        if (pct - lastReported >= 1) {
          lastReported = pct;
          try { await queue.progress(job.id, pct); } catch (_) { /* non-fatal */ }
        }
      } else if (stream === 'stderr') {
        try { await repo.appendLog(job.id, 'warn', line.slice(0, 500)); } catch (_) {}
      }
    });

    try {
      const { code } = await proc.done;
      if (code === 0) {
        const outs = await adapter.collectOutputs(workdir);
        for (const f of outs) await repo.addFile(job.id, f);
        await queue.complete(job.id);
        await repo.appendLog(job.id, 'info', `klaar, ${outs.length} bestand(en)`);
        logger.info('job.done', { job: job.id, files: outs.length });
      } else {
        const retry = job.attempts < job.max_attempts;
        await queue.fail(job.id, `exit ${code}`, { retry });
        await repo.appendLog(job.id, retry ? 'warn' : 'error', `exit ${code}${retry ? ' (retry)' : ''}`);
        logger.warn('job.failed', { job: job.id, code, retry });
      }
    } catch (err) {
      const retry = job.attempts < job.max_attempts;
      await queue.fail(job.id, String(err.message || err), { retry });
      logger.error('job.error', { job: job.id, err: String(err.message || err) });
    }
  }

  async function loop() {
    while (!stopping) {
      if (active.size >= concurrency) { await sleep(pollMs); continue; }
      const job = await queue.claimNext(workerId).catch((e) => {
        logger.error('queue.claim.error', { err: String(e.message || e) });
        return null;
      });
      if (!job) { await sleep(pollMs); continue; }
      const p = runOne(job).finally(() => active.delete(p));
      active.add(p);
    }
    await Promise.all(active);
  }

  const loopPromise = loop();

  async function stop() {
    stopping = true;
    await loopPromise;
  }

  return { stop, workerId };
}

module.exports = { startWorkerPool };
