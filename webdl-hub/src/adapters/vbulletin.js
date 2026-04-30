// src/adapters/vbulletin.js
'use strict';

const path = require('path');
const { defineAdapter } = require('./base');

module.exports = defineAdapter({
  name: 'vbulletin',
  priority: 80, // Hoger dan algemene fallbacks
  
  matches: (url) => {
    return url.includes('amateurvoyeurforum.com');
  },
  
  plan: async (url, opts) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vbulletin-dl.js');
    
    // Voeg #all toe als dit specifiek gevraagd wordt (voorlopig optioneel,
    // de gebruiker kan dit zelf aan de URL in de UI toevoegen, of we breiden opts uit).
    let targetUrl = url;
    
    return {
      cmd: process.execPath, // node
      args: [scriptPath, targetUrl],
      env: { ...process.env } // Neemt AVF_COOKIE over via config/omgeving
    };
  },
  
  parseProgress: (line) => {
    // We loggen voortgang als: [vbulletin-progress] 3/10
    const match = line.match(/\[vbulletin-progress\] (\d+)\/(\d+)/);
    if (match) {
      const current = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      return { pct: (current / total) * 100 };
    }
    return null;
  }
});
