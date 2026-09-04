# TradeQuote (Netlify edition)

Same TradeQuote app, restructured to run on Netlify: the frontend in
`public/` is served as a static site, and the backend logic (`/api/chat`,
`/api/health`) runs as Netlify Functions instead of a persistent Express
server.

## Project structure

```
tradequote-netlify/
├── netlify.toml              # tells Netlify where the site + functions live
├── netlify/functions/
│   ├── chat.js                 # POST /api/chat  (chat + tool-use loop)
│   └── health.js                # GET  /api/health
├── masterPrompt.js              # system prompt, shared by chat.js
├── matching.js                   # Google Places live search + demo fallback
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example
└── package.json
```

The frontend still calls `/api/chat` and `/api/health` exactly as before —
`netlify.toml` has a redirect rule that transparently routes those paths to
the functions, so nothing in `public/app.js` needed to change.

## Deploy steps (no local Node install required)

1. **Get your Anthropic API key** at console.anthropic.com/settings/keys
   (required). Optionally get a Google Places API key too (enables live
   tradesmen matching instead of demo data).
2. **Push this folder to a GitHub repo** — create a new repo, then use
   GitHub's "Add file > Upload files" to add everything in this folder
   (make sure `netlify.toml`, `netlify/functions/`, `public/`, etc. all end
   up at the top level of the repo, not nested inside an extra folder).
3. **Go to app.netlify.com** and sign in.
4. Click **Add new site > Import an existing project**, choose GitHub, and
   select your repo.
5. Netlify should auto-detect the settings from `netlify.toml` (publish
   directory `public`, functions directory `netlify/functions`). Leave the
   build command as `npm install`.
6. Before or right after the first deploy, go to **Site configuration >
   Environment variables** and add:
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_PLACES_API_KEY` (optional)
   - `ANTHROPIC_MODEL` (optional, defaults to a sensible value)
7. Click **Deploy site** (or **Trigger deploy** if you added the env vars
   after the first deploy — env var changes need a redeploy to take
   effect).
8. Once it's live, open the site URL and click "Start My Estimate" to test.

## Local testing (optional, needs Node + Netlify CLI)

```bash
npm install -g netlify-cli
npm install
cp .env.example .env      # fill in your keys
netlify dev
```

This runs the static site and the functions together on one local URL,
simulating the production redirect behavior.

## Notes

- No `.env` file is ever uploaded to GitHub — real keys only go into
  Netlify's Environment variables UI in production, and into your own local
  `.env` (gitignored) for `netlify dev`.
- Demo-mode fallback for tradesmen matching works exactly as in the original
  version: if `GOOGLE_PLACES_API_KEY` isn't set, `matching.js` returns
  clearly-labeled example listings instead of failing.
