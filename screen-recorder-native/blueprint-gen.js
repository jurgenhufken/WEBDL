const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageNumber, Header, Footer, ExternalHyperlink
} = require('docx');
const fs = require('fs');

// ── Kleuren ──────────────────────────────────────────────────────────────────
const C = {
  accent:   '1A1A2E',   // donker navy
  mid:      '16213E',
  blue:     '0F3460',
  highlight:'E94560',   // rood-accent
  lightBg:  'F0F4F8',
  midBg:    'D9E4F0',
  white:    'FFFFFF',
  text:     '1A1A2E',
  sub:      '4A5568',
};

const border = { style: BorderStyle.SINGLE, size: 1, color: 'D0D7DE' };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// ── Helpers ───────────────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
    children: [new TextRun({ text, bold: true, size: 36, color: C.accent, font: 'Arial' })]
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text, bold: true, size: 28, color: C.blue, font: 'Arial' })]
  });
}

function h3(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, color: C.mid, font: 'Arial' })]
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 120 },
    children: [new TextRun({ text, size: 22, color: C.text, font: 'Arial', ...opts })]
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 22, color: C.text, font: 'Arial' })]
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midBg, space: 1 } },
    children: []
  });
}

function labeledRow(label, value, shade = false) {
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: 2800, type: WidthType.DXA },
        shading: shade ? { fill: C.lightBg, type: ShadingType.CLEAR } : { fill: C.white, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: 'Arial', color: C.accent })] })]
      }),
      new TableCell({
        borders,
        width: { size: 6560, type: WidthType.DXA },
        shading: { fill: C.white, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: 'Arial', color: C.text })] })]
      }),
    ]
  });
}

function twoColRow(left, right, headerRow = false) {
  const fill = headerRow ? C.accent : C.white;
  const textColor = headerRow ? C.white : C.text;
  const bold = headerRow;
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: left, bold, size: 20, font: 'Arial', color: textColor })] })]
      }),
      new TableCell({
        borders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: right, bold, size: 20, font: 'Arial', color: textColor })] })]
      }),
    ]
  });
}

function highlightBox(title, lines) {
  const children = [
    new Paragraph({
      spacing: { before: 60, after: 100 },
      children: [new TextRun({ text: title, bold: true, size: 22, font: 'Arial', color: C.highlight })]
    }),
    ...lines.map(l => new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: l, size: 20, font: 'Arial', color: C.text })]
    }))
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [new TableCell({
          borders: {
            top: { style: BorderStyle.SINGLE, size: 6, color: C.highlight },
            bottom: border, left: border, right: border
          },
          shading: { fill: 'FFF5F7', type: ShadingType.CLEAR },
          margins: { top: 140, bottom: 140, left: 200, right: 200 },
          children
        })]
      })
    ]
  });
}

function sectionBox(title, lines) {
  const children = [
    new Paragraph({
      spacing: { before: 60, after: 100 },
      children: [new TextRun({ text: title, bold: true, size: 22, font: 'Arial', color: C.white })]
    }),
    ...lines.map(l => new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: l, size: 20, font: 'Arial', color: C.white })]
    }))
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [new TableCell({
          borders: noBorders,
          shading: { fill: C.accent, type: ShadingType.CLEAR },
          margins: { top: 160, bottom: 160, left: 240, right: 240 },
          children
        })]
      })
    ]
  });
}

function spacer(pts = 160) {
  return new Paragraph({ spacing: { before: 0, after: pts }, children: [] });
}

// ── Document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ]
      },
      {
        reference: 'numbers',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ]
      }
    ]
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: C.accent },
        paragraph: { spacing: { before: 400, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: C.blue },
        paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midBg, space: 6 } },
          children: [new TextRun({ text: 'WEBDL \u2014 Product Blauwdruk', size: 18, color: C.sub, font: 'Arial' })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.midBg, space: 6 } },
          children: [
            new TextRun({ text: 'Vertrouwelijk \u2014 ', size: 18, color: C.sub, font: 'Arial' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.sub, font: 'Arial' }),
          ]
        })]
      })
    },
    children: [

      // ── TITELBLAD ───────────────────────────────────────────────────────────
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            borders: noBorders,
            shading: { fill: C.accent, type: ShadingType.CLEAR },
            margins: { top: 480, bottom: 480, left: 480, right: 480 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
                children: [new TextRun({ text: 'WEBDL', size: 64, bold: true, font: 'Arial', color: C.white })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 },
                children: [new TextRun({ text: 'Media Library \u2014 Product Blauwdruk', size: 28, font: 'Arial', color: C.midBg })] }),
              new Paragraph({ alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Versie 1.0 \u2014 April 2026', size: 20, font: 'Arial', color: C.sub })] }),
            ]
          })]
        })]
      }),

      spacer(400),

      // ── EXECUTIVE SUMMARY ───────────────────────────────────────────────────
      sectionBox('In \u00E9\u00E9n zin', [
        'WEBDL is een lokale mediabibliotheek waarmee je media van het internet kunt verzamelen,',
        'organiseren en genieten \u2014 met een viewer die daar centraal in staat.',
      ]),

      spacer(300),

      // ── 1. PRODUCTVISIE ─────────────────────────────────────────────────────
      h1('1. Productvisie'),

      p('WEBDL is geen download-manager. Het is een mediabibliotheek met een downloader als ingang. Het onderscheid is belangrijk: de gebruiker wil niet downloaden, de gebruiker wil genieten van zijn collectie.'),
      spacer(60),
      p('De doelgroep is de digitale verzamelaar: iemand die media van meerdere platformen (YouTube, OnlyFans, Reddit, Telegram, Instagram, etc.) wil bewaren en beheren in \u00E9\u00E9n overzichtelijke, lokale bibliotheek \u2014 zonder afhankelijk te zijn van een extern platform.'),
      spacer(60),
      p('De adult-niche is het eerste doelmarkt omdat daar de pijn het grootst is: gebruikers verzamelen enorme hoeveelheden media van platforms die content kunnen verwijderen, en hebben geen fatsoenlijk gereedschap om dat te organiseren en te bekijken.'),

      spacer(200),
      divider(),

      // ── 2. KERNFILOSOFIE ────────────────────────────────────────────────────
      h1('2. Kernfilosofie'),

      h2('2.1 De drie wetten'),

      spacer(60),
      highlightBox('Wet 1 \u2014 De viewer is het product', [
        'Alles staat in dienst van de kijkervaring. Downloads, imports, organisatie \u2014 het zijn middelen.',
        'Het einddoel is altijd: de gebruiker geniet van zijn media.',
      ]),
      spacer(120),
      highlightBox('Wet 2 \u2014 Het bestand is de waarheid', [
        'Een mediabestand dat op disk staat, bestaat \u2014 ongeacht of de database het kent.',
        'De database is een snelle index en metadata-cache, geen bron van waarheid.',
        'De database moet altijd volledig herbouwbaar zijn vanuit het filesystem.',
      ]),
      spacer(120),
      highlightBox('Wet 3 \u2014 Voorkom dubbel werk, toon duplicaten eerlijk', [
        'Voordat iets gedownload wordt: check op URL. Zelfde URL = al in de bibliotheek, gebruiker krijgt melding.',
        'In de gallery: duplicaten mogen zichtbaar zijn (het is een query), maar de gebruiker kiest wat er met dubbelen gebeurt.',
        'De app dwingt niets af, maar informeert altijd.',
      ]),

      spacer(200),

      h2('2.2 Wat de database bijhoudt'),
      spacer(80),
      p('De database heeft \u00E9\u00E9n verantwoordelijkheid per tabeltype:'),
      spacer(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 6560],
        rows: [
          labeledRow('Tabel', 'Verantwoordelijkheid', true),
          labeledRow('downloads', 'Downloadjobs: geschiedenis, status, URL, platform, channel, title'),
          labeledRow('download_files', 'Welke bestanden horen bij welke job (pad + mtime)'),
          labeledRow('screenshots', 'Screenshot-entries met bronmetadata'),
          labeledRow('tags / media_tags', 'Gebruikersdata: labels die de gebruiker heeft toegevoegd'),
          labeledRow('ratings', 'Gebruikersdata: beoordelingen'),
        ]
      }),
      spacer(120),
      p('Alles wat regenereerbaar is vanuit het bestand (thumbnail, duur, bestandsgrootte, resolutie) is een cache, geen waarheid.', { italic: true, color: C.sub }),

      spacer(200),
      divider(),

      // ── 3. DE VIER PIJLERS ──────────────────────────────────────────────────
      h1('3. De vier pijlers'),

      p('De app bestaat uit vier functionele lagen. Elke laag heeft een eigen verantwoordelijkheid.'),
      spacer(120),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4680, 4680],
        rows: [
          twoColRow('Pijler', 'Kernverantwoordelijkheid', true),
          twoColRow('1. Ingest', 'Media binnenhalen: downloaden, importeren, screen recording'),
          twoColRow('2. Bibliotheek', 'Opslaan, indexeren, organiseren op disk + DB'),
          twoColRow('3. Viewer', 'Bekijken, navigeren, genieten \u2014 het product'),
          twoColRow('4. Beheer', 'Zoeken, filteren, tags, ratings, dedup, onderhoud'),
        ]
      }),

      spacer(200),

      h2('Pijler 1 \u2014 Ingest'),
      p('De ingest-laag is puur functioneel: het haalt media op en legt het op de juiste plek op disk neer. Ondersteunde methoden:'),
      bullet('Downloader-integraties: yt-dlp, gallery-dl, ofscraper, instaloader, tdl, reddit-dl, directe bestanden'),
      bullet('Screen recording via AVFoundation (ffmpeg)'),
      bullet('Handmatige import van bestaande mappen op disk'),
      bullet('Browser-extensie integratie (VDH hints, directe download triggers)'),
      spacer(80),
      p('URL-deduplicatie zit in de ingest-laag: v\u00F3\u00F3r het starten van een download wordt gecheckt of de URL al succesvol is verwerkt. De gebruiker krijgt een duidelijke melding en de keuze.'),

      spacer(160),

      h2('Pijler 2 \u2014 Bibliotheek'),
      p('De bibliotheek-laag beheert de relatie tussen bestanden op disk en de database-index. Kernregels:'),
      bullet('Mappenstructuur op disk: BASE_DIR / platform / channel / (optioneel: title/)'),
      bullet('Een bestand zonder DB-entry wordt getoond in de gallery (filesystem is waarheid)'),
      bullet('Een DB-entry zonder bestand op disk wordt als "ontbrekend" gemarkeerd, niet verwijderd'),
      bullet('Reindex is altijd volledig mogelijk: scan disk \u2192 update DB'),
      bullet('Thumbnail-cache: gegenereerd door ffmpeg, opgeslagen naast het bestand op disk'),

      spacer(160),

      h2('Pijler 3 \u2014 Viewer (het product)'),
      p('De viewer is de kern van de gebruikerservaring. Hier wordt ge\u00EFnvesteerd. Vereisten:'),
      bullet('Snelle, vloeiende gallery met lazy loading en cursor-paginering'),
      bullet('Video player met volledige keyboard controls (spatiebalk, pijltjes, J/K/L)'),
      bullet('Per-kanaal en per-platform browsing'),
      bullet('Willekeurige afspeelmodus (shuffle)'),
      bullet('Tagging en ratings direct vanuit de viewer'),
      bullet('Dubbel-tap / snelkoppeling voor volgende/vorige item'),
      bullet('Thumbnail-preview on hover'),
      bullet('Volledige-scherm modus'),

      spacer(160),

      h2('Pijler 4 \u2014 Beheer'),
      p('Beheerfuncties voor het onderhoud van de bibliotheek:'),
      bullet('Zoeken op titel, platform, channel, tag, URL'),
      bullet('Duplicate scanner: toont bestanden met overlappende paden of URL\u2019s'),
      bullet('Stuck-download repair: detecteert en herstelt vastgelopen downloads'),
      bullet('Disk-scan: indexeert bestanden die de DB niet kent'),
      bullet('Batch-acties: selecteer meerdere items, verwijder, re-tag, verplaats'),

      spacer(200),
      divider(),

      // ── 4. DATA-FILOSOFIE ───────────────────────────────────────────────────
      h1('4. Data-filosofie'),

      h2('4.1 Mappenstructuur op disk'),
      p('De fysieke locatie van een bestand communiceert al zijn metadata:'),
      spacer(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            borders,
            shading: { fill: 'F6F8FA', type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [
              new Paragraph({ children: [new TextRun({ text: 'BASE_DIR/', font: 'Courier New', size: 20, bold: true, color: C.accent })] }),
              new Paragraph({ children: [new TextRun({ text: '  {platform}/', font: 'Courier New', size: 20, color: C.blue })] }),
              new Paragraph({ children: [new TextRun({ text: '    {channel}/', font: 'Courier New', size: 20, color: C.mid })] }),
              new Paragraph({ children: [new TextRun({ text: '      {title}.mp4', font: 'Courier New', size: 20, color: C.text })] }),
              new Paragraph({ children: [new TextRun({ text: '      {title}.jpg  \u2190 thumbnail naast het bestand', font: 'Courier New', size: 20, color: C.sub })] }),
            ]
          })]
        })]
      }),
      spacer(120),
      p('Een bestand op het juiste pad in BASE_DIR is altijd vindbaar en toonbaar, ongeacht de DB-staat.'),

      spacer(160),

      h2('4.2 Deduplicatie'),
      p('Twee niveaus, twee logica\u2019s:'),
      spacer(80),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 6560],
        rows: [
          labeledRow('Niveau', 'Logica', true),
          labeledRow('Download-preventie', 'V\u00F3\u00F3r downloaden: check op URL in downloads-tabel. Bij match: toon melding met link naar bestaand item. Gebruiker kiest zelf.'),
          labeledRow('Gallery-weergave', 'Duplicaten zijn zichtbaar (het is een query). De duplicate scanner in Beheer toont overlappende items. Gebruiker verwijdert handmatig of via batch.'),
        ]
      }),

      spacer(200),
      divider(),

      // ── 5. OPEN SOURCE + PREMIUM ────────────────────────────────────────────
      h1('5. Open Source & Premium strategie'),

      p('WEBDL wordt open source uitgebracht. Een betaalde Premium laag biedt extra\u2019s die de kernervaring verrijken maar niet blokkeren.'),
      spacer(120),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4680, 4680],
        rows: [
          twoColRow('Free (Open Source)', 'Premium', true),
          twoColRow('Volledige gallery en viewer', 'Geavanceerde viewer features (playlist, autoplay series)'),
          twoColRow('Alle downloader-integraties', 'Slimme dedup met content-hashing'),
          twoColRow('Tags en ratings', 'Cloud sync van metadata (tags, ratings)'),
          twoColRow('Basis zoeken en filteren', 'AI-gegenereerde beschrijvingen en tags'),
          twoColRow('Screen recording', 'Prioriteits-support en vroege toegang tot features'),
          twoColRow('Import en reindex', 'Mobiele companion app (bekijken op telefoon)'),
        ]
      }),

      spacer(120),
      p('Kernprincipe: de viewer en de bibliotheek zijn altijd volledig gratis. Premium versnelt en verrijkt, blokkeert nooit.', { bold: true }),

      spacer(200),
      divider(),

      // ── 6. ARCHITECTUURSCHETS ───────────────────────────────────────────────
      h1('6. Architectuurschets (high-level)'),

      p('De applicatie bestaat uit drie lagen die strikt gescheiden zijn:'),
      spacer(120),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2200, 7160],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 2200, type: WidthType.DXA },
                shading: { fill: C.accent, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                verticalAlign: 'center',
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Frontend', bold: true, size: 22, font: 'Arial', color: C.white })] })]
              }),
              new TableCell({
                borders,
                width: { size: 7160, type: WidthType.DXA },
                shading: { fill: C.lightBg, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                children: [new Paragraph({ children: [new TextRun({ text: 'Gallery UI, Viewer, Dashboard, Queue panel \u2014 puur HTML/JS, communiceert via REST + Socket.io', size: 20, font: 'Arial', color: C.text })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 2200, type: WidthType.DXA },
                shading: { fill: C.blue, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                verticalAlign: 'center',
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Server', bold: true, size: 22, font: 'Arial', color: C.white })] })]
              }),
              new TableCell({
                borders,
                width: { size: 7160, type: WidthType.DXA },
                shading: { fill: C.white, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                children: [new Paragraph({ children: [new TextRun({ text: 'Express + Socket.io. Routes, services, downloaders \u2014 gemodulariseerd via context-injectie (ctx)', size: 20, font: 'Arial', color: C.text })] })]
              }),
            ]
          }),
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: 2200, type: WidthType.DXA },
                shading: { fill: C.mid, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                verticalAlign: 'center',
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Data', bold: true, size: 22, font: 'Arial', color: C.white })] })]
              }),
              new TableCell({
                borders,
                width: { size: 7160, type: WidthType.DXA },
                shading: { fill: C.lightBg, type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                children: [new Paragraph({ children: [new TextRun({ text: 'PostgreSQL (index + metadata) + Filesystem (bron van waarheid). DB is altijd herbouwbaar.', size: 20, font: 'Arial', color: C.text })] })]
              }),
            ]
          }),
        ]
      }),

      spacer(160),

      h2('Servermodules (doelstructuur)'),
      bullet('server.js \u2014 entry-point, compositeert alles (~200 regels)'),
      bullet('config.js \u2014 alle instellingen vanuit .env'),
      bullet('state/index.js \u2014 alle mutable globals op \u00E9\u00E9n plek'),
      bullet('db/ \u2014 connectie, schema, queries (factory-pattern)'),
      bullet('services/ \u2014 download-queue, thumb-gen, auto-import, recording'),
      bullet('downloaders/ \u2014 \u00E9\u00E9n bestand per downloader-type'),
      bullet('routes/ \u2014 Express routes per domein (media, downloads, admin)'),
      bullet('views/ \u2014 KLAAR (viewer, gallery, dashboard ge\u00EBxtraheerd)'),
      bullet('utils/ \u2014 pure hulpfuncties (paths, url-helpers, ffmpeg)'),

      spacer(200),
      divider(),

      // ── 7. ONTWERPPRINCIPES ─────────────────────────────────────────────────
      h1('7. Ontwerpprincipes voor nieuwe features'),

      p('Bij elke nieuwe feature of wijziging: toets aan deze principes.'),
      spacer(100),

      new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: 'Viewer-first: maakt het de kijkervaring beter?', bold: true, size: 22, font: 'Arial', color: C.accent })] }),
      new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: 'DB als index: sla alleen op wat niet regenereerbaar is.', bold: true, size: 22, font: 'Arial', color: C.accent })] }),
      new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: 'Informeer, dwing niet af: geef de gebruiker inzicht en keuze.', bold: true, size: 22, font: 'Arial', color: C.accent })] }),
      new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: 'Kleine bestanden, heldere verantwoordelijkheden: geen modules > 500 regels.', bold: true, size: 22, font: 'Arial', color: C.accent })] }),
      new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: 'Open Source kern: premium verrijkt, blokkeert nooit.', bold: true, size: 22, font: 'Arial', color: C.accent })] }),

      spacer(300),

      // ── AFSLUITING ──────────────────────────────────────────────────────────
      sectionBox('Dit document is de blauwdruk \u2014 niet de code.', [
        'Elke architectuurbeslissing, elke nieuwe feature, elke refactor-keuze',
        'wordt getoetst aan de principes in dit document.',
        'Code verandert. De filosofie is stabiel.',
      ]),

    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/sessions/sharp-brave-feynman/mnt/WEBDL/screen-recorder-native/WEBDL-Blauwdruk.docx', buffer);
  console.log('Done.');
}).catch(e => { console.error(e); process.exit(1); });
