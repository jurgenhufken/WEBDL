# webdl-core

Centrale module met de WEBDL architectuur per `~/WEBDL/ARCHITECTURE.md`.

**Status:** in opbouw — stap 1 (Source interface) + stap 2 (vipergirls reference) lopen.

## Directory-structuur

```
webdl-core/
├── README.md              ← dit bestand
├── sources/               ← per host: hoe pagina's te begrijpen
│   ├── source.js          ← Source interface (JSDoc types)
│   └── vipergirls.js      ← 1e reference implementatie
├── jobs/                  ← scheduler, Job-type, queue-state
│   └── scheduler.js       ← (TODO)
└── workers/               ← downloaders: yt-dlp / python / fetch
    └── (TODO)
```

## Beslissingen

| Beslissing | Keuze | Reden |
|---|---|---|
| Taal | JavaScript + JSDoc + `// @ts-check` | Geen build-step. Type-safety via JSDoc waar belangrijk. TypeScript-migratie blijft optioneel (zie ARCHITECTURE.md §5.1). |
| Runtime | Node (zoals simple-server.js) | Geen extra deps. |
| Process model | In-process (require'd door simple-server.js) | Splitsen naar aparte service kan later. |
| DB-migrations | psql scripts in `migrations/` | Consistent met bestaande aanpak. |
| Job-polling | SSE (Server-Sent Events) op `/api/jobs/:id/events` | Real-time, simpler dan WebSocket. |

## Contract — Source

Zie `sources/source.js` voor de volledige interface met JSDoc. Korte versie:

```js
// Elke host implementeert dit:
{
  id: 'vipergirls',                                   // unieke key
  matches: (url) => true|false,                       // is dit mijn host?
  detectPageType: (url) => 'single'|'listing'|null,   // wat voor pagina?
  inspect: async (url) => ({ items, paginationUrls, channel, title }),
  paginate: (baseUrl, pageNum) => 'next-page-url',
  deriveChannel: (url) => 'channel_name',
  features: { paginate, wholeThread, wrapperResolve, ... }
}
```

## Contract — Job

```js
{
  id: 42,
  intent: 'single'|'page'|'whole-thread'|'forum-scan',
  sourceId: 'vipergirls',
  sourceUrl: 'https://...',
  parentJobId: 41,         // optional
  status: 'queued'|'running'|'done'|'error',
  itemsTotal: 113,
  itemsDone: 110,
  itemsError: 1
}
```

## Contract — Worker (TODO)

Zie ARCHITECTURE.md §2.

## Hoe wordt dit aangeroepen?

Vanuit `screen-recorder-native/src/simple-server.js`:

```js
const { Sources } = require('../../webdl-core/sources');
const { Scheduler } = require('../../webdl-core/jobs/scheduler');

expressApp.post('/api/jobs', async (req, res) => {
  const { intent, url } = req.body;
  const source = Sources.findForUrl(url);
  if (!source) return res.status(400).json({ error: 'no source for this URL' });
  const job = await Scheduler.create({ intent, url, source });
  res.json({ jobId: job.id, status: job.status });
});

expressApp.get('/api/jobs/:id', async (req, res) => {
  const job = await Scheduler.get(req.params.id);
  res.json(job);
});
```

## Hoe nieuwe site toevoegen?

1. Maak `sources/<host>.js` (~50-80 regels)
2. Implementeer Source interface
3. Registreer in `sources/index.js`
4. Klaar — extensie + scheduler weten automatisch wat te doen

Geen UI-code, geen scheduler-code, geen DB-code per site nodig.
