'use strict';
/**
 * Routes: Pages — Pijler: Viewer
 * 
 * Serveert de eigen 0.2 gallery.
 * Geen koppeling met v1 views.
 */
const path = require('path');
const express = require('express');

module.exports = function mountPageRoutes(app, ctx) {
  const publicDir = path.join(__dirname, '..', 'public');

  // Static files (CSS, JS, images)
  app.use('/static', express.static(publicDir));

  // Gallery
  app.get('/gallery', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'gallery.html'));
  });

  // Root → gallery
  app.get('/', (req, res) => res.redirect('/gallery'));
};
