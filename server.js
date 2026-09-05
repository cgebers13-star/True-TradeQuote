require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = require('./masterPrompt');
const FORM_SYSTEM_PROMPT = require('./formPrompt');
const { runFindTradesmen } = require('./matching');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const FIND_TRADESMEN_TOOL = {
  name: 'find_tradesmen',
  description:
    "Search for top-rated local tradesmen. Call this ONLY after you have already given the client a cost estimate range in your own reply text, AND you have both a determined trade category and a location (city/state or ZIP) from the client. Returns up to 5 matching businesses meeting rating/review thresholds, widening the search radius automatically if needed. Never call this more than once per job unless the client changes their trade or location.",
  input_schema: {
    type: 'object',
    properties: {
      trade_category: {
        type: 'string',
        description:
          'The specific trade/service category to search for, e.g. "plumber", "electrician", "roofer", "HVAC technician", "general contractor", "locksmith".'
      },
      location: {
        type: 'string',
        description:
          'City and state, or ZIP code, provided by the client, e.g. "Atlanta, GA" or "30305".'
      },
      urgent: {
        type: 'boolean',
        description:
          'True if the job was flagged URGENT (needs emergency/same-day service).'
      },
      min_rating: {
        type: 'number',
        description: 'Minimum star rating filter. Defaults to 4.0.'
      },
      min_reviews: {
        type: 'number',
        description: 'Minimum review count filter. Defaults to 10.'
      }
    },
    required: ['trade_category', 'location']
  }
};

const SUBMIT_SCOPING_TOOL = {
  name: 'submit_scoping',
  description: 'Submit the structured scoping result for this job so it can be shown to the client.',
  input_schema: {
    type: 'object',
    properties: {
      trade_category: {
        type: 'string',
        description: 'The single best-fit trade category, e.g. "plumber", "electrician", "HVAC technician", "roofer", "general contractor".'
      },
      urgent: {
        type: 'boolean',
        description: 'True if ASAP was selected, or the description contains a genuine urgent/safety indicator.'
      },
      cost_estimate_low: { type: 'number', description: 'Low end of the rough cost range, in US dollars.' },
      cost_estimate_high: { type: 'number', description: 'High end of the rough cost range, in US dollars.' },
      estimate_note: {
        type: 'string',
        description: '1-2 sentences on the biggest factor(s) that could move the price up or down.'
      },
      safety_warning: {
        type: 'string',
        description: 'Only include this field if there is a genuine life-safety indicator. Omit entirely otherwise.'
      }
    },
    required: ['trade_category', 'urgent', 'cost_estimate_low', 'cost_estimate_high', 'estimate_note']
  }
};

const URGENCY_LABELS = {
  asap: 'ASAP — needs it fixed as soon as possible',
  week: 'Within the next few days',
  month: 'Within the next month',
  flexible: 'Flexible / just exploring options for now'
};

app.get('/api/health', (req, res) => {
  res.json({
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    placesConfigured: !!process.env.GOOGLE_PLACES_API_KEY
  });
});

app.post('/api/chat', async (req, res) => {
  if (!anthropic) {
    return res.status(500).json({
      error:
        'Server is not configured with an ANTHROPIC_API_KEY. Add one to your .env file and restart the server.'
    });
  }

  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'A non-empty messages array is required.' });
    }

    let workingMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    let finalText = '';
    let lastMatchResult = null;
    let toolRounds = 0;
    const MAX_TOOL_ROUNDS = 3;

    while (toolRounds < MAX_TOOL_ROUNDS) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [FIND_TRADESMEN_TOOL],
        messages: workingMessages
      });

      const toolUse = response.content.find((b) => b.type === 'tool_use');

      if (!toolUse) {
        finalText = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n');
        break;
      }

      toolRounds++;
      workingMessages.push({ role: 'assistant', content: response.content });

      const result = await runFindTradesmen(toolUse.input);
      lastMatchResult = result;

      workingMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          }
        ]
      });

      if (toolRounds === MAX_TOOL_ROUNDS) {
        const wrapUp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: workingMessages
        });
        finalText = wrapUp.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n');
      }
    }

    res.json({
      reply: finalText,
      matches: lastMatchResult?.matches || null,
      matchMeta: lastMatchResult
        ? {
            dataSource: lastMatchResult.data_source,
            radiusWidened: !!lastMatchResult.radius_widened,
            radiusUsedMiles: lastMatchResult.radius_used_miles
          }
        : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

// One-shot form flow backing public/estimate.html — takes { job, location,
// urgency }, gets a structured scoping result from Claude via a forced
// tool call, then runs the tradesmen search directly (no back-and-forth
// conversation, unlike /api/chat).
app.post('/api/estimate', async (req, res) => {
  if (!anthropic) {
    return res.status(500).json({
      error:
        'Server is not configured with an ANTHROPIC_API_KEY. Add one to your .env file and restart the server.'
    });
  }

  const job = (req.body.job || '').trim();
  const location = (req.body.location || '').trim();
  const urgency = req.body.urgency || 'flexible';

  if (!job || !location) {
    return res.status(400).json({ error: "Please tell us what the job is and where you're located." });
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: FORM_SYSTEM_PROMPT,
      tools: [SUBMIT_SCOPING_TOOL],
      tool_choice: { type: 'tool', name: 'submit_scoping' },
      messages: [
        {
          role: 'user',
          content: `Job description: ${job}\nLocation: ${location}\nStated urgency: ${URGENCY_LABELS[urgency] || urgency}`
        }
      ]
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      return res.status(502).json({ error: 'The assistant did not return a usable estimate. Please try again.' });
    }

    const scoping = toolUse.input || {};
    const urgent = !!scoping.urgent || urgency === 'asap';

    const matchResult = await runFindTradesmen({
      trade_category: scoping.trade_category,
      location,
      urgent
    });

    res.json({
      tradeCategory: scoping.trade_category,
      urgent,
      costEstimate: {
        low: scoping.cost_estimate_low,
        high: scoping.cost_estimate_high,
        note: scoping.estimate_note
      },
      safetyWarning: scoping.safety_warning || null,
      matches: matchResult.matches || [],
      matchMeta: {
        dataSource: matchResult.data_source,
        radiusWidened: !!matchResult.radius_widened,
        radiusUsedMiles: matchResult.radius_used_miles
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

app.listen(PORT, () => {
  console.log(`TradeQuote server running at http://localhost:${PORT}`);
  console.log(
    `  Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'MISSING (chat will not work)'}`
  );
  console.log(
    `  Google Places API key: ${
      process.env.GOOGLE_PLACES_API_KEY ? 'configured (live matching)' : 'not set (demo matching data will be used)'
    }`
  );
});
