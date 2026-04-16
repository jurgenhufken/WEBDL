/**
 * WEBDL 0.2 — Grid module
 * 
 * Rendert media items in het grid.
 * Weet niets van API of routing — krijgt alleen data.
 */
const Grid = {
  container: null,
  loadingEl: null,
  emptyEl: null,

  init() {
    this.container = document.getElementById('grid');
    this.loadingEl = document.getElementById('grid-loading');
    this.emptyEl = document.getElementById('grid-empty');
  },

  /** Render een lijst items (append of replace) */
  render(items, append = false) {
    if (!append) this.container.innerHTML = '';
    this.emptyEl.style.display = 'none';
    this.loadingEl.style.display = 'none';

    if (items.length === 0 && !append) {
      this.emptyEl.style.display = 'flex';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      frag.appendChild(this.createCard(item));
    }
    this.container.appendChild(frag);
  },

  /** Maak één grid card */
  createCard(item) {
    const el = document.createElement('div');
    el.className = 'grid-item';
    el.dataset.id = item.id;
    el.dataset.kind = item.kind;

    // Thumbnail
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = item.thumb;
    img.alt = item.title || '';
    img.onerror = function() {
      this.style.display = 'none';
      el.style.background = 'linear-gradient(135deg, var(--bg-elevated), var(--bg-hover))';
    };
    el.appendChild(img);

    // Badge (type)
    if (item.type === 'video') {
      const badge = document.createElement('span');
      badge.className = 'grid-item-badge';
      badge.textContent = item.duration || '▶';
      el.appendChild(badge);
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'grid-item-overlay';
    overlay.innerHTML = `
      <div class="grid-item-title">${escapeHtml(item.title || '')}</div>
      <div class="grid-item-meta">${escapeHtml(item.platform)}/${escapeHtml(item.channel)}</div>
    `;
    el.appendChild(overlay);

    // Click → open viewer
    el.addEventListener('click', () => {
      if (typeof App !== 'undefined' && App.openViewer) {
        App.openViewer(item);
      }
    });

    return el;
  },

  showLoading() {
    this.loadingEl.style.display = 'flex';
  },

  hideLoading() {
    this.loadingEl.style.display = 'none';
  },

  clear() {
    this.container.innerHTML = '';
    this.emptyEl.style.display = 'none';
  },
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
