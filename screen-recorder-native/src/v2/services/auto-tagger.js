'use strict';

/**
 * Service: Auto-Tagger
 * Parst bestandsnamen, titels en paden om nuttige, schone tags te genereren.
 * Bevat specifieke regels voor prioriteits-categorieën.
 */

// Standaard stopwoorden (resoluties, formaten, nutteloze woorden)
const STOP_WORDS = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'jpg', 'jpeg', 'png', 'gif',
  '1080p', '720p', '4k', '1440p', '2160p', 'hd', 'fhd', 'uhd', 'sd',
  'video', 'download', 'the', 'and', 'with', 'for', 'you', 'from', 'in',
  'on', 'at', 'to', 'of', 'my', 'your', 'is', 'are', 'this', 'that',
  'www', 'com', 'net', 'org', 'http', 'https', 'feat', 'ft'
]);

// Speciale fetish/prioriteitswoorden (altijd als tag behouden)
const PRIORITY_WORDS = new Set([
  'feet', 'foot', 'sole', 'soles', 'toe', 'toes', 'barefoot', 'barefooted',
  'heel', 'heels', 'arch', 'arches', 'pedicure', 'nylon', 'nylons', 'socks',
  'pantyhose', 'wrinkled', 'wrinkles', 'sweaty', 'stinky', 'smelly', 'sniff'
]);

/**
 * Parst een ruwe string (titel of bestandsnaam) en retourneert een lijst schone tags
 */
function extractTagsFromString(text) {
  if (!text || typeof text !== 'string') return [];
  
  // 1. Zoek naar expliciete hashtags (bv #barefoot)
  const hashtags = [];
  const hashRegex = /#([a-zA-Z0-9_]+)/g;
  let match;
  while ((match = hashRegex.exec(text)) !== null) {
    hashtags.push(match[1].toLowerCase());
  }

  // 2. Verwijder speciale tekens, splits op spaties/underscores/koppeltekens
  const cleanText = text.toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, ' ') // Alleen letters en cijfers behouden
    .replace(/[\s_\-]+/g, ' ') // Meerdere spaties/underscores samenvoegen
    .trim();

  const words = cleanText.split(' ');
  const tags = new Set(hashtags);

  for (let word of words) {
    if (word.length < 3) continue; // Te kort
    if (!isNaN(word)) continue; // Puur numeriek
    if (STOP_WORDS.has(word)) continue; // Negeer stopwoorden
    
    // Voeg prioriteitswoorden toe of algemene woorden (optioneel kunnen we algemene uitsluiten, 
    // maar voor nu pakken we alle relevante woorden > 3 letters)
    tags.add(word);
  }

  // Zet terug naar een schone array
  return Array.from(tags).filter(t => t.length > 2);
}

/**
 * Hoofdfunctie om alle metadata te combineren in 1 tag-lijst
 */
function generateTagsForMedia(media) {
  const allTags = new Set();

  // 1. Platform & Kanaal (altijd als harde tags toevoegen)
  if (media.platform && media.platform !== 'unknown') {
    allTags.add(media.platform.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }
  if (media.channel && media.channel !== 'unknown') {
    allTags.add(media.channel.toLowerCase().replace(/[^a-z0-9]/g, ''));
  }

  // 2. Parse de titel
  if (media.title && media.title !== 'untitled') {
    const titleTags = extractTagsFromString(media.title);
    titleTags.forEach(t => allTags.add(t));
  }

  // 3. Parse de map/pad structuur (erg handig voor lokale downloads zoals Reddit/X)
  if (media.filepath) {
    const parts = media.filepath.split(/[/\\]/);
    if (parts.length > 2) {
      // Gebruik de naam van de direct bovenliggende mappen
      const parentDir = parts[parts.length - 2];
      if (parentDir && parentDir !== '_Downloads' && parentDir !== 'WEBDL' && parentDir !== 'unknown') {
        const dirTags = extractTagsFromString(parentDir);
        dirTags.forEach(t => allTags.add(t));
      }
    }
  }

  return Array.from(allTags);
}

module.exports = {
  extractTagsFromString,
  generateTagsForMedia,
  PRIORITY_WORDS
};
