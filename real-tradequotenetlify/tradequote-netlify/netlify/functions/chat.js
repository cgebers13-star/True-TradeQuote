// Netlify Function equivalent of the old Express POST /api/chat route.
// Netlify's redirect rule (see netlify.toml) maps /api/chat -> this function.

const Anthropic = require('@anthropic-ai/sdk');
const SYSTEM_PROMPT = require('../../masterPrompt');
const { runFindTradesmen } = require('../../matching');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOOL_ROUNDS = 3;

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
        description: 'True if the job was flagged URGENT (needs emergency/same-day service).'
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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          'This site is not configured with an ANTHROPIC_API_KEY. Add it under Site configuration > Environment variables in Netlify, then redeploy.'
      })
    };
  }

  let messages;
  try {
    const body = JSON.parse(event.body || '{}');
    messages = body.messages;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'A non-empty messages array is required.' })
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    let workingMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    let finalText = '';
    let lastMatchResult = null;
    let toolRounds = 0;

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

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: finalText,
        matches: lastMatchResult?.matches || null,
        matchMeta: lastMatchResult
          ? {
              dataSource: lastMatchResult.data_source,
              radiusWidened: !!lastMatchResult.radius_widened,
              radiusUsedMiles: lastMatchResult.radius_used_miles
            }
          : null
      })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Something went wrong.' })
    };
  }
};
