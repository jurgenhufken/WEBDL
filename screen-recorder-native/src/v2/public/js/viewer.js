/**
 * WEBDL 0.2 — Viewer module
 * 
 * Opent media in een overlay. Video playback, image preview.
 */
const Viewer = {
  el: null,
  contentEl: null,
  infoEl: null,
  currentItem: null,

  init() {
    this.el = document.getElementById('viewer');
    this.contentEl = document.getElementById('viewer-content');
    this.infoEl = document.getElementById('viewer-info');

    document.getElementById('viewer-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.el.style.display !== 'none') this.close();
    });
  },

  open(item) {
    this.currentItem = item;
    this.contentEl.innerHTML = '';
    this.infoEl.innerHTML = '';

    if (item.type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.src = item.src;
      video.onerror = () => {
        this.contentEl.innerHTML = '<div style="color:var(--error);padding:20px">Video kon niet worden geladen.</div>';
      };
      this.contentEl.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.title || '';
      this.contentEl.appendChild(img);
    }

    this.infoEl.innerHTML = `
      <div class="viewer-info-title">${escapeHtml(item.title)}</div>
      <div class="viewer-info-meta">${escapeHtml(item.platform)} / ${escapeHtml(item.channel)}</div>
    `;

    this.el.style.display = 'flex';
  },

  close() {
    // Stop video
    const video = this.contentEl.querySelector('video');
    if (video) { video.pause(); video.src = ''; }

    this.el.style.display = 'none';
    this.currentItem = null;
  },
};
