// Handles Step 6 of the master prompt: turning (trade_category, location)
// into real, filtered/sorted/matched tradesmen via Google Places, with a
// clearly-labeled mock-data fallback when no API key is configured.
//
// FUTURE WORK: ranking currently uses Google's public rating + review count
// (see the sort in liveSearch() below). The product plan is to eventually
// weight or replace this with whether a tradesman has an active TradeQuote
// subscription — that change belongs here (the qualifying/sort logic),
// not in the callers (chat.js / estimate.js).

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

const RADIUS_STEPS_MILES = [15, 25, 40];
const DEFAULT_MIN_RATING = 4.0;
const DEFAULT_MIN_REVIEWS = 10;
const TOP_N = 5;

function milesToMeters(mi) {
  return Math.round(mi * 1609.34);
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeLocation(location) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    location
  )}&key=${GOOGLE_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' || !data.results?.length) {
    return null;
  }
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, formattedAddress: data.results[0].formatted_address };
}

async function nearbySearch(lat, lng, keyword, radiusMeters) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(
    keyword
  )}&key=${GOOGLE_KEY}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`Places API error: ${data.status} ${data.error_message || ''}`);
  }
  return data.results || [];
}

async function getPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website,url,opening_hours&key=${GOOGLE_KEY}`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== 'OK') return {};
    return data.result || {};
  } catch {
    return {};
  }
}

async function liveSearch({ trade_category, location, urgent, min_rating, min_reviews }) {
  const minRating = min_rating || DEFAULT_MIN_RATING;
  const minReviews = min_reviews || DEFAULT_MIN_REVIEWS;

  const geo = await geocodeLocation(location);
  if (!geo) {
    return {
      data_source: 'live',
      matches: [],
      radius_widened: false,
      error: `Could not find a location for "${location}".`
    };
  }

  const seen = new Map();
  let radiusUsedMiles = RADIUS_STEPS_MILES[0];
  let widened = false;

  for (let i = 0; i < RADIUS_STEPS_MILES.length; i++) {
    radiusUsedMiles = RADIUS_STEPS_MILES[i];
    if (i > 0) widened = true;

    const results = await nearbySearch(
      geo.lat,
      geo.lng,
      trade_category,
      milesToMeters(radiusUsedMiles)
    );

    for (const r of results) {
      if (!r.place_id || seen.has(r.place_id)) continue;
      const dist = haversineMiles(
        geo.lat,
        geo.lng,
        r.geometry?.location?.lat,
        r.geometry?.location?.lng
      );
      seen.set(r.place_id, {
        place_id: r.place_id,
        name: r.name,
        rating: r.rating ?? null,
        review_count: r.user_ratings_total ?? 0,
        distance_miles: Math.round(dist * 10) / 10,
        address: r.vicinity || null,
        open_now: r.opening_hours?.open_now ?? null,
        business_status: r.business_status || null
      });
    }

    const qualifying = [...seen.values()].filter(
      (p) => (p.rating ?? 0) >= minRating && p.review_count >= minReviews
    );
    if (qualifying.length >= TOP_N) break;
  }

  let qualifying = [...seen.values()].filter(
    (p) => (p.rating ?? 0) >= minRating && p.review_count >= minReviews
  );

  qualifying.sort((a, b) => {
    if (b.rating !== a.rating) return (b.rating ?? 0) - (a.rating ?? 0);
    return a.distance_miles - b.distance_miles;
  });

  const top = qualifying.slice(0, TOP_N);

  // Enrich only the final top matches with phone/website (extra API calls).
  await Promise.all(
    top.map(async (p) => {
      const details = await getPlaceDetails(p.place_id);
      p.phone = details.formatted_phone_number || null;
      p.website = details.website || details.url || null;
    })
  );

  return {
    data_source: 'live',
    location_resolved: geo.formattedAddress,
    trade_category,
    urgent: !!urgent,
    radius_used_miles: radiusUsedMiles,
    radius_widened: widened,
    matches: top.map(({ place_id, ...rest }) => rest)
  };
}

// ---- Mock fallback (used when GOOGLE_PLACES_API_KEY is not configured) ----

const MOCK_BUSINESS_NAMES = [
  'Summit', 'Reliable', 'Precision', 'Ironclad', 'Northside',
  'Lakeview', 'Pioneer', 'Crestline', 'Metro', 'Anchor'
];
const MOCK_SUFFIXES = {
  plumber: ['Plumbing Co.', 'Plumbing & Drain', 'Pipe Works'],
  electrician: ['Electric', 'Electrical Services', 'Power & Light'],
  hvac: ['Heating & Air', 'HVAC Solutions', 'Climate Control'],
  roofer: ['Roofing Co.', 'Roofing & Exteriors', 'Roof Works'],
  default: ['Home Services', 'Contracting', 'Repair Co.']
};

function pickSuffixes(trade) {
  const key = Object.keys(MOCK_SUFFIXES).find((k) =>
    trade.toLowerCase().includes(k)
  );
  return MOCK_SUFFIXES[key] || MOCK_SUFFIXES.default;
}

function mockSearch({ trade_category, location, urgent }) {
  const suffixes = pickSuffixes(trade_category || '');
  const ratings = [4.9, 4.8, 4.7, 4.6, 4.6];
  const reviews = [212, 138, 95, 61, 34];
  const distances = [1.8, 2.6, 3.4, 4.1, 5.2];

  const matches = Array.from({ length: TOP_N }, (_, i) => ({
    name: `${MOCK_BUSINESS_NAMES[i % MOCK_BUSINESS_NAMES.length]} ${
      suffixes[i % suffixes.length]
    }`,
    rating: ratings[i],
    review_count: reviews[i],
    distance_miles: distances[i],
    address: null,
    phone: `(555) ${100 + i * 11}-${1000 + i * 137}`,
    website: null,
    open_now: urgent ? true : null,
    specialty_note: urgent
      ? `Offers 24/7 emergency ${trade_category} service`
      : `Handles ${trade_category} jobs of all sizes`
  }));

  return {
    data_source: 'demo',
    location_resolved: location,
    trade_category,
    urgent: !!urgent,
    radius_used_miles: RADIUS_STEPS_MILES[0],
    radius_widened: false,
    matches
  };
}

async function runFindTradesmen(input) {
  const args = {
    trade_category: input.trade_category,
    location: input.location,
    urgent: !!input.urgent,
    min_rating: input.min_rating,
    min_reviews: input.min_reviews
  };

  if (!GOOGLE_KEY) {
    return mockSearch(args);
  }

  try {
    return await liveSearch(args);
  } catch (err) {
    console.error('Live tradesmen search failed, falling back to demo data:', err);
    return { ...mockSearch(args), fallback_reason: err.message };
  }
}

module.exports = { runFindTradesmen };
