// src/queue/queue.js — dunne wrapper rond repo, met job-events voor WS.
'use strict';

const { EventEmitter } = require('node:events');

function createQueue({ repo }) {
  const events = new EventEmitter();

  async function enqueue({ url, adapter, priority = 0, options = {}, maxAttempts = 3, lane = null }) {
    const job = await repo.createJob({ url, adapter, priority, options, maxAttempts, lane });
    events.emit('job:created', job);
    return job;
  }

  async function claimNext(workerId, { lane = null } = {}) {
    const job = await repo.claimNextJob(workerId, { lane });
    if (job) events.emit('job:claimed', job);
    return job;
  }

  async function complete(id) {
    const job = await repo.completeJob(id);
    if (job) events.emit('job:done', job);
    return job;
  }

  async function fail(id, err, { retry = false } = {}) {
    const job = await repo.failJob(id, err, { retry });
    events.emit(retry ? 'job:retry' : 'job:failed', job);
    return job;
  }

  async function cancel(id) {
    const job = await repo.cancelJob(id);
    if (job) events.emit('job:cancelled', job);
    return job;
  }

  async function progress(id, pct, extra = {}) {
    await repo.updateProgress(id, pct);
    events.emit('job:progress', { id, pct, speed: extra.speed || null, eta: extra.eta || null });
  }

  return { events, enqueue, claimNext, complete, fail, cancel, progress };
}

module.exports = { createQueue };
