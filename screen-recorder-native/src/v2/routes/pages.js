'use strict';
/**
 * Routes: Pages — Pijler: Viewer
 * 
 * Serveert de HTML pagina's. Hergebruikt de al-geëxtraheerde views.
 */
const getViewerHTML = require('../../views/viewer');
const getGalleryHTML = require('../../views/gallery');

module.exports = function mountPageRoutes(app, ctx) {

  app.get('/gallery', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getGalleryHTML());
  });

  app.get('/viewer', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getViewerHTML());
  });

  // Redirect root to gallery
  app.get('/', (req, res) => {
    res.redirect('/gallery');
  });
};
