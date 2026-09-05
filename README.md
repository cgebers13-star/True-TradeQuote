# TradeQuote

A standalone AI job calculator: homeowners describe a job, get it scoped,
get a rough non-binding cost estimate, and get matched to the top 5 rated
local tradesmen for that job. Built from the TradeQuote master prompt (see
`masterPrompt.js`). This is a plain Node/Express app — a normal persistent
server, not serverless functions — which is what lets it run on hosts like
Hostinger's Managed Node.js plan or a VPS.

There are two ways a client gets an estimate + matches:

- **The form (primary path)** — "Get My Free Estimate" goes to
  `public/estimate.html`: a short form (job description, location,
  urgency). One submit calls `/api/estimate`, which scopes the job,
  estimates a cost range, and returns matched tradesmen all at once.
- **The chat assistant (secondary path)** — a floating "Chat with us"
  button on the homepage opens the original conversational assistant
  (`/api/chat`), which walks through the master prompt's Steps 1-6 turn
  by turn.

Both share the same tradesmen-matching logic (`matching.js`, powered by the
Google Places API — Geocoding + Nearby Search + Place Details, filtered to
4.0★+ with 10+ reviews, sorted by rating then distance, with automatic
radius widening 15 → 25 → 40 mi if fewer than 5 qualify) and the same
demo-mode fallback: if no Google Places key is configured, the app still
runs end-to-end using clearly-labeled example tradesmen listings instead of
failing, and always discloses when it's showing demo data.

## 1. Get your API keys

**Anthropic (required — powers the chat assistant)**
1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key.

**Google Places (optional — powers live tradesmen matching)**
1. Go to https://console.cloud.google.com/
2. Create/select a project, then enable **Places API** and **Geocoding API**
   under "APIs & Services".
3. Create an API key under "Credentials". For production, restrict the key
   to those two APIs and to your server's IP.

Without the Google key, TradeQuote still works — it just shows realistic
demo listings and tells the client so.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_PLACES_API_KEY=...      # optional
```

## 3. Install & run

```bash
npm install
npm start
```

Open http://localhost:3000 and click "Start My Estimate."

## Project structure

```
tradequote/
├── server.js            # Express server: /api/chat, /api/estimate, /api/health
├── matching.js           # Google Places live search + demo-data fallback (shared)
├── masterPrompt.js         # System prompt for the chat assistant
├── formPrompt.js             # System prompt for the one-shot form flow
├── public/
│   ├── index.html               # Landing page (chat FAB + links to estimate.html)
│   ├── estimate.html              # The estimate form + results page
│   ├── estimate.js                 # Form submit / results rendering logic
│   ├── style.css
│   └── app.js                       # Chat panel logic (used on index.html)
├── .env.example
└── package.json
```

## How the matching logic works

`/api/chat` gives Claude one tool, `find_tradesmen`, which it calls itself
mid-conversation once it has a cost estimate, trade category, and location.
`/api/estimate` works differently since the form is one-shot and can't ask
follow-up questions: it forces a single structured tool call
(`submit_scoping`) out of Claude covering trade category, urgency, cost
range, and an optional safety warning, then calls the tradesmen search
directly itself — no second Claude round-trip. Both paths end up calling
the same `runFindTradesmen()` in `matching.js` against Google Places (or
demo data), which never fabricates business names, ratings, or reviews.

## Deploying to Hostinger

This app runs as a normal persistent Node server (`app.listen`), which is
exactly what Hostinger's **Managed Node.js Hosting** plan (or a VPS) runs —
no serverless rewrite needed.

1. In hPanel: **Websites → Add Website → Deploy Web App → Upload your
   website files**.
2. Upload a `.zip` of this folder (exclude `node_modules` — Hostinger runs
   `npm install` for you automatically).
3. If asked for an entry file, enter `server.js`.
4. Add your environment variables in the app's settings panel:
   `ANTHROPIC_API_KEY` (required) and `GOOGLE_PLACES_API_KEY` (optional).
   Never put real keys in `.env` before zipping — `.env` is gitignored for
   a reason; set the real values only in Hostinger's dashboard.
5. Deploy. Hostinger assigns the port via `process.env.PORT`, which
   `server.js` already reads, so no code changes are needed there.
6. Once live, visit the site and test both "Get My Free Estimate" (the
   form) and the floating "Chat with us" button.

It'll also run unmodified on GoDaddy's Node.js Hosting, Railway, Render, a
VPS, or any other host that runs a persistent Node 18+ process — the same
zip works everywhere, since none of this depends on a specific platform's
serverless function format.

## Notes on scope

Per the master prompt, this version is intentionally **show-only**: no
contact info is collected or stored, no payments are taken, and TradeQuote
never books or negotiates with a tradesman on the client's behalf. A future
"lead-selling" feature (Step 6.5) is described but not implemented here —
see Section 5 of the master prompt in the project docs.
