// Netlify Function equivalent of the old Express GET /api/health route.

exports.handler = async function () {
  return {
    statusCode: 200,
    body: JSON.stringify({
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
      placesConfigured: !!process.env.GOOGLE_PLACES_API_KEY
    })
  };
};
