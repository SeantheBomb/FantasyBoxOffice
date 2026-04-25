# fbo-cron

Scheduled Cloudflare Worker for Fantasy Box Office. Runs three crons against
the same D1 database as the Pages project.

## Local dev

```
cd worker
npx wrangler dev --local
# trigger a job manually:
curl 'http://localhost:8787/trigger?job=movies'
curl 'http://localhost:8787/trigger?job=dailies'
curl 'http://localhost:8787/trigger?job=settle'
```

## Deploy

```
cd worker
npx wrangler deploy
# bind secrets:
npx wrangler secret put TMDB_TOKEN
```
