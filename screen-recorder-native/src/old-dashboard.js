function getDashboardHTML(downloads, screenshots) {
  function dashCaptureKind(d) {
    try {
      const u = String(d && d.url ? d.url : '');
      if (u.startsWith('recording:')) return 'recording';
      const raw = String(d && d.metadata ? d.metadata : '').trim();
      if (raw) {
        const m = JSON.parse(raw);
        if (m && m.webdl_kind === 'recording') return 'recording';
        if (m && m.tool === 'gallery-dl') return 'gallery';
      }
    } catch (e) {}
    if (String(d && d.filename ? d.filename : '') === '(multiple)') return 'gallery';
    return 'download';
  }

  function dashFootFetishForumThreadId(d) {
    try {
      const u = String((d && (d.source_url || d.url)) || '');
      const m = u.match(/footfetishforum\.com\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      return m ? String(m[1] || '') : '';
    } catch (e) {
      return '';
    }
  }

  function dashSortKeyTs(d) {
    try {
      const u = (d && (d.updated_at || d.created_at)) ? String(d.updated_at || d.created_at) : '';
      return u || '';
    } catch (e) {
      return '';
    }
  }

  function dashMediaTypeFromPath(fp) {
    try {
      const p = String(fp || '');
      const ext = String(path.extname(p).toLowerCase() || '');
      if (['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(ext)) return 'video';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(ext)) return 'image';
      return 'file';
    } catch (e) {
      return 'file';
    }
  }

  const downloadGroups = new Map();
  for (const d of (Array.isArray(downloads) ? downloads : [])) {
    const tid = dashFootFetishForumThreadId(d);
    const key = tid ? `fff:${tid}` : `id:${d && d.id}`;
    const g = downloadGroups.get(key) || { key, threadId: tid || '', items: [] };
    if (!downloadGroups.has(key)) downloadGroups.set(key, g);
    if (tid) g.threadId = tid;
    g.items.push(d);
  }

  const groupedDownloads = Array.from(downloadGroups.values()).map((g) => {
    const items = (g.items || []).slice().sort((a, b) => {
      const as = dashSortKeyTs(a);
      const bs = dashSortKeyTs(b);
      if (as && bs && as !== bs) return bs.localeCompare(as);
      const ai = Number(a && a.id != null ? a.id : 0);
      const bi = Number(b && b.id != null ? b.id : 0);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;
      return 0;
    });
    const rep = items[0] || {};
    const statuses = new Set(items.map(x => String(x && x.status ? x.status : '')));
    let aggStatus = String(rep.status || '');
    if (statuses.has('downloading') || statuses.has('postprocessing')) aggStatus = 'downloading';
    else if (statuses.has('queued') || statuses.has('pending')) aggStatus = 'queued';
    else if (statuses.has('error')) aggStatus = 'error';
    else if (statuses.has('cancelled')) aggStatus = 'cancelled';
    else if (statuses.has('completed')) aggStatus = 'completed';

    const aggProgress = (() => {
      let p = 0;
      for (const it of items) {
        const st = String(it && it.status ? it.status : '');
        if (st === 'downloading' || st === 'postprocessing') {
          const v = Number(it && it.progress != null ? it.progress : 0);
          if (Number.isFinite(v)) p = Math.max(p, v);
        }
      }
      return Math.max(0, Math.min(100, Math.round(p)));
    })();

    const totalSize = (() => {
      let sum = 0;
      for (const it of items) {
        const v = Number(it && it.filesize != null ? it.filesize : 0);
        if (Number.isFinite(v) && v > 0) sum += v;
      }
      return sum || 0;
    })();

    return {
      ...rep,
      _group: g.threadId ? 'fff-thread' : '',
      _threadId: g.threadId || '',
      _count: items.length,
      _aggStatus: aggStatus,
      _aggProgress: aggProgress,
      _ids: items.map(x => x && x.id).filter(x => Number.isFinite(Number(x))),
      _totalSize: totalSize
    };
  }).sort((a, b) => {
    const as = dashSortKeyTs(a);
    const bs = dashSortKeyTs(b);
    if (as && bs && as !== bs) return bs.localeCompare(as);
    const ai = Number(a && a.id != null ? a.id : 0);
    const bi = Number(b && b.id != null ? b.id : 0);
    if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;
    return 0;
  });

  const downloadRows = groupedDownloads.map(d => {
    const isGroup = d && d._group === 'fff-thread' && (d._count || 0) > 1;
    const status = isGroup ? String(d._aggStatus || '') : String(d.status || '');
    const progress = isGroup ? Number(d._aggProgress || 0) : Number(d.progress || 0);
    const ids = isGroup ? (Array.isArray(d._ids) ? d._ids : []) : [];
    const stopBtn = (() => {
      if (!isGroup) {
        return (status === 'queued' || status === 'downloading' || status === 'postprocessing')
          ? `<button onclick="cancelDownload(${d.id})" class="btn btn-sm btn-danger">Stop</button>`
          : '';
      }
      return (status === 'queued' || status === 'downloading' || status === 'postprocessing')
        ? `<button onclick='cancelDownloadGroup(${JSON.stringify(ids)})' class="btn btn-sm btn-danger">Stop</button>`
        : '';
    })();

    const title = isGroup
      ? `Thread ${String(d._threadId || '')} (${Number(d._count || 0)}) — ${String(d.title || '')}`
      : String(d.title || '');

    const sizeCell = (() => {
      const sz = isGroup ? Number(d._totalSize || 0) : Number(d.filesize || 0);
      return sz ? (sz / 1024 / 1024).toFixed(1) + ' MB' : '-';
    })();

    return `
    <tr class="status-${status}">
      <td>${d.id}${isGroup ? ` <span style="color:#666">(${Number(d._count || 0)})</span>` : ''}</td>
      <td>${d.filepath ? `<img src="/download/${d.id}/thumb?v=3" style="width:64px;height:36px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" />` : ''}</td>
      <td><span class="badge">${dashCaptureKind(d)} / ${dashMediaTypeFromPath(d.filepath)}${isGroup ? ' / thread' : ''}</span></td>
      <td><span class="badge badge-${d.platform}">${d.platform}</span></td>
      <td>${d.channel}</td>
      <td class="title-cell">${title}</td>
      <td><span class="status status-${status}">${status}${(status === 'downloading' || status === 'postprocessing') ? ` (${Math.max(0, Math.min(100, progress))}%)` : ''}</span></td>
      <td>${sizeCell}</td>
      <td>${new Date(d.created_at).toLocaleString('nl-NL')}</td>
      <td>
        ${stopBtn}
        ${d.filepath ? `<button onclick="openMedia('d', ${d.id})" class="btn btn-sm">Open</button>` : ''}
        ${d.filepath ? `<button onclick="showInFinder('d', ${d.id})" class="btn btn-sm">Finder</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const screenshotRows = screenshots.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${s.filepath ? `<img src="/media/thumb?kind=s&id=${s.id}" style="width:64px;height:36px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'" />` : ''}</td>
      <td><span class="badge">screenshot / image</span></td>
      <td><span class="badge badge-${s.platform}">${s.platform}</span></td>
      <td>${s.channel}</td>
      <td>${s.title}</td>
      <td>${s.filename}</td>
      <td>${s.filesize ? (s.filesize / 1024).toFixed(0) + ' KB' : '-'}</td>
      <td>${new Date(s.created_at).toLocaleString('nl-NL')}</td>
      <td>
        ${s.filepath ? `<button onclick="openMedia('s', ${s.id})" class="btn btn-sm">Open</button>` : ''}
        ${s.filepath ? `<button onclick="showInFinder('s', ${s.id})" class="btn btn-sm">Finder</button>` : ''}
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WEBDL Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { color: #00d4ff; margin-bottom: 5px; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .stats { display: flex; gap: 15px; margin-bottom: 20px; }
    .stat { background: #16213e; padding: 15px 20px; border-radius: 8px; flex: 1; }
    .stat-num { font-size: 28px; font-weight: bold; color: #00d4ff; }
    .stat-label { color: #888; font-size: 13px; }
    h2 { color: #00d4ff; margin: 20px 0 10px; }
    table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
    th { background: #0f3460; padding: 10px; text-align: left; font-size: 13px; color: #aaa; }
    td { padding: 8px 10px; border-top: 1px solid #1a1a2e; font-size: 13px; }
    .title-cell { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
    .badge-youtube { background: #ff0000; color: white; }
    .badge-vimeo { background: #1ab7ea; color: white; }
    .badge-twitch { background: #9146ff; color: white; }
    .badge-other { background: #555; color: white; }
    .status { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .status-completed { color: #4caf50; }
    .status-downloading { color: #ff9800; }
    .status-postprocessing { color: #c084fc; }
    .status-queued { color: #aaa; }
    .status-pending { color: #2196f3; }
    .status-error { color: #f44336; }
    .status-cancelled { color: #999; }
    .btn { padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; background: #0f3460; color: white; }
    .btn:hover { background: #00d4ff; color: #1a1a2e; }
    .btn-danger { background: #c0392b; }
    .btn-danger:hover { background: #e74c3c; }
    .refresh { position: fixed; top: 20px; right: 20px; }
    .viewer { position: fixed; top: 60px; right: 20px; }
    .path-info { color: #666; font-size: 12px; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>WEBDL Dashboard</h1>
  <p class="subtitle">Video download manager</p>
  <p class="path-info">📁 ${BASE_DIR}</p>
  <button class="btn refresh" onclick="location.reload()">🔄 Vernieuwen</button>
  <button class="btn viewer" onclick="window.open('/viewer','_blank')">📺 Viewer</button>

  <div class="stats">
    <div class="stat">
      <div class="stat-num">${downloads.length}</div>
      <div class="stat-label">Downloads</div>
    </div>
    <div class="stat">
      <div class="stat-num">${downloads.filter(d => d.status === 'completed').length}</div>
      <div class="stat-label">Voltooid</div>
    </div>
    <div class="stat">
      <div class="stat-num">${downloads.filter(d => d.status === 'downloading').length}</div>
      <div class="stat-label">Actief</div>
    </div>
    <div class="stat">
      <div class="stat-num">${screenshots.length}</div>
      <div class="stat-label">Screenshots</div>
    </div>
  </div>

  <h2>Downloads</h2>
  <table>
    <thead><tr><th>#</th><th>Thumb</th><th>Type</th><th>Platform</th><th>Kanaal</th><th>Titel</th><th>Status</th><th>Grootte</th><th>Datum</th><th>Acties</th></tr></thead>
    <tbody>${downloadRows || '<tr><td colspan="10" style="text-align:center;color:#666;">Nog geen downloads</td></tr>'}</tbody>
  </table>

  <h2>Screenshots</h2>
  <table>
    <thead><tr><th>#</th><th>Thumb</th><th>Type</th><th>Platform</th><th>Kanaal</th><th>Titel</th><th>Bestand</th><th>Grootte</th><th>Datum</th><th>Acties</th></tr></thead>
    <tbody>${screenshotRows || '<tr><td colspan="10" style="text-align:center;color:#666;">Nog geen screenshots</td></tr>'}</tbody>
  </table>

  <script>
    async function cancelDownload(id) {
      await fetch('/download/' + id + '/cancel', { method: 'POST' });
      location.reload();
    }
    async function cancelDownloadGroup(ids) {
      try {
        if (!Array.isArray(ids) || !ids.length) return;
        for (const id of ids) {
          try {
            await fetch('/download/' + id + '/cancel', { method: 'POST' });
          } catch (e) {}
        }
      } catch (e) {}
      location.reload();
    }
    async function openFile(path) {
      // Kan niet direct bestanden openen vanuit browser, kopieer pad
      navigator.clipboard.writeText(path);
      alert('Pad gekopieerd: ' + path);
    }
    async function openMedia(kind, id) {
      const resp = await fetch('/media/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action: 'open' })
      });
      const data = await resp.json().catch(() => null);
      if (!data || !data.success) alert((data && data.error) ? data.error : 'Open mislukt');
    }
    async function showInFinder(kind, id) {
      const resp = await fetch('/media/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, action: 'finder' })
      });
      const data = await resp.json().catch(() => null);
      if (!data || !data.success) alert((data && data.error) ? data.error : 'Finder mislukt');
    }
    async function startDashboardLivePoll() {
      try {
        let last = null;
        const tick = async () => {
          try {
            const resp = await fetch('/api/stats', { cache: 'no-store' });
            const data = await resp.json().catch(() => null);
            const s = data && data.stats ? data.stats : null;
            if (s) {
              const key = [s.downloads, s.screenshots, s.download_files, s.downloads_last, s.screenshots_last, s.download_files_last].join('|');
              if (last && key !== last) location.reload();
              last = key;
            }
          } catch (e) {}
        };
        setInterval(tick, 2500);
        tick();
      } catch (e) {}
    }
    // Auto-refresh elke 5 seconden als er actieve downloads zijn
    ${downloads.some(d => d.status === 'downloading' || d.status === 'postprocessing') ? 'setTimeout(() => location.reload(), 5000);' : ''}
    startDashboardLivePoll();
  </script>
</body>
</html>`;