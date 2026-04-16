/**
 * WEBDL 0.2 — Sidebar module
 * 
 * Channels, filters, zoeken.
 * Weet niets van het grid — roept App callbacks aan.
 */
const Sidebar = {
  channelList: null,
  channels: [],
  activeChannel: null,

  init() {
    this.channelList = document.getElementById('channel-list');
    this.initFilters();
    this.initSearch();
  },

  initFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (typeof App !== 'undefined') App.setFilter(btn.dataset.type);
      });
    });
  },

  initSearch() {
    const input = document.getElementById('search-input');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (typeof App !== 'undefined') App.setSearch(input.value);
      }, 300);
    });
  },

  /** Render de kanalenlijst */
  renderChannels(channels) {
    this.channels = channels;
    this.channelList.innerHTML = '';

    // "Alles" item
    const allItem = document.createElement('div');
    allItem.className = 'channel-item' + (this.activeChannel === null ? ' active' : '');
    allItem.innerHTML = '<span class="channel-platform">⌂</span><span class="channel-name">Alle kanalen</span>';
    allItem.addEventListener('click', () => {
      this.activeChannel = null;
      this.highlightActive();
      if (typeof App !== 'undefined') App.setChannel(null);
    });
    this.channelList.appendChild(allItem);

    for (const ch of channels) {
      const el = document.createElement('div');
      el.className = 'channel-item';
      el.innerHTML = `
        <span class="channel-platform">${escapeHtml(ch.platform)}</span>
        <span class="channel-name">${escapeHtml(ch.channel)}</span>
        <span class="channel-count">${ch.count}</span>
      `;
      el.addEventListener('click', () => {
        this.activeChannel = ch;
        this.highlightActive();
        if (typeof App !== 'undefined') App.setChannel(ch);
      });
      this.channelList.appendChild(el);
    }
  },

  highlightActive() {
    const items = this.channelList.querySelectorAll('.channel-item');
    items.forEach((el, i) => {
      if (i === 0) {
        el.classList.toggle('active', this.activeChannel === null);
      } else {
        const ch = this.channels[i - 1];
        el.classList.toggle('active',
          this.activeChannel && ch.platform === this.activeChannel.platform && ch.channel === this.activeChannel.channel
        );
      }
    });
  },

  renderStats(stats) {
    document.getElementById('stats').textContent =
      `${(stats.downloads || 0).toLocaleString()} downloads · ${(stats.download_files || 0).toLocaleString()} bestanden`;
  },
};
