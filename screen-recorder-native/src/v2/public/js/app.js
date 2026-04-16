/**
 * WEBDL 0.2 — App module (orchestrator)
 * 
 * Verbindt API, Grid, Sidebar, Viewer.
 * Beheert state: welk kanaal, welk filter, cursor.
 */
const App = {
  state: {
    filter: 'all',
    search: '',
    channel: null,   // { platform, channel }
    cursor: '',
    loading: false,
    done: false,
  },

  async init() {
    Grid.init();
    Sidebar.init();
    Viewer.init();

    // Laad data
    this.loadStats();
    this.loadChannels();
    this.loadItems();

    // Infinite scroll
    const main = document.getElementById('main');
    main.addEventListener('scroll', () => {
      if (this.state.loading || this.state.done) return;
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 300) {
        this.loadMore();
      }
    });
  },

  // --- Data laden ---
  async loadStats() {
    try {
      const data = await API.getStats();
      if (data.success) Sidebar.renderStats(data.stats);
    } catch (e) {}
  },

  async loadChannels() {
    try {
      const data = await API.getChannels();
      if (data.success) Sidebar.renderChannels(data.channels);
    } catch (e) {}
  },

  async loadItems() {
    this.state.cursor = '';
    this.state.done = false;
    this.state.loading = true;
    Grid.showLoading();

    try {
      let data;
      if (this.state.channel) {
        data = await API.getChannelFiles(
          this.state.channel.platform,
          this.state.channel.channel,
          { type: this.state.filter, q: this.state.search }
        );
      } else {
        data = await API.getRecentFiles({
          type: this.state.filter,
          q: this.state.search,
        });
      }

      if (data.success) {
        Grid.render(data.items, false);
        this.state.cursor = data.next_cursor || '';
        this.state.done = data.done !== false;
      }
    } catch (e) {
      console.error('[0.2] Load error:', e);
    } finally {
      this.state.loading = false;
      Grid.hideLoading();
    }
  },

  async loadMore() {
    if (!this.state.cursor || this.state.loading) return;
    this.state.loading = true;
    Grid.showLoading();

    try {
      let data;
      if (this.state.channel) {
        data = await API.getChannelFiles(
          this.state.channel.platform,
          this.state.channel.channel,
          { type: this.state.filter, cursor: this.state.cursor, q: this.state.search }
        );
      } else {
        data = await API.getRecentFiles({
          type: this.state.filter,
          cursor: this.state.cursor,
          q: this.state.search,
        });
      }

      if (data.success) {
        Grid.render(data.items, true);
        this.state.cursor = data.next_cursor || '';
        this.state.done = data.done !== false;
      }
    } catch (e) {
      console.error('[0.2] Load more error:', e);
    } finally {
      this.state.loading = false;
      Grid.hideLoading();
    }
  },

  // --- Actions vanuit modules ---
  setFilter(type) {
    this.state.filter = type;
    this.loadItems();
  },

  setSearch(q) {
    this.state.search = q;
    this.loadItems();
  },

  setChannel(ch) {
    this.state.channel = ch;
    this.loadItems();
  },

  openViewer(item) {
    Viewer.open(item);
  },
};

// Start
document.addEventListener('DOMContentLoaded', () => App.init());
