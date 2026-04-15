import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import { Resend } from 'resend';
import cron from 'node-cron';

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const CITY_INTEL_URL = process.env.CITY_INTEL_URL || 'https://landalyze-production.up.railway.app/city-intel';
const FROM_EMAIL = process.env.RESEND_FROM || 'digest@landalyze.com';

// ─── Database ────────────────────────────────────────────────────────────────

const { Pool } = pg;
let pool = null;

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log('[db] DATABASE_URL not set — subscriptions disabled');
    return;
  }
  try {
    const candidate = new Pool({ connectionString: process.env.DATABASE_URL });
    await candidate.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id           SERIAL PRIMARY KEY,
        email        TEXT    NOT NULL,
        city         TEXT    NOT NULL,
        frequency    TEXT    NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_sent_at TIMESTAMPTZ,
        active       BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX IF NOT EXISTS idx_subscriptions_email     ON subscriptions(email);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_frequency ON subscriptions(frequency, active);
    `);
    pool = candidate;
    console.log('[db] PostgreSQL connected');
  } catch (err) {
    console.error('[db] PostgreSQL unavailable — subscriptions disabled:', err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatIntelEmail(city, intel) {
  const bullets = (intel.digest || [])
    .map(b => `<li style="margin-bottom:8px">${b}</li>`)
    .join('');
  const sources = (intel.sources || [])
    .map(s => `<li><a href="${s}" style="color:#4f46e5">${s}</a></li>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
  <div style="border-bottom:2px solid #4f46e5;padding-bottom:12px;margin-bottom:24px">
    <h1 style="margin:0;font-size:22px">Landalyze City Intel</h1>
    <p style="margin:4px 0 0;color:#6b7280;font-size:14px">${city} &mdash; ${new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>
  <h2 style="font-size:16px;color:#4f46e5;margin-bottom:12px">What's Happening</h2>
  <ul style="padding-left:20px;line-height:1.6">${bullets}</ul>
  ${sources ? `<h2 style="font-size:14px;color:#6b7280;margin-top:24px">Sources</h2><ul style="padding-left:20px;font-size:13px;color:#6b7280">${sources}</ul>` : ''}
  <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
  <p style="font-size:12px;color:#9ca3af;margin-top:12px">
    You're receiving this because you subscribed to city intel for ${city}.
    Reply to this email to unsubscribe.
  </p>
</body>
</html>`;
}

async function sendCityIntel(sub) {
  const response = await fetch(CITY_INTEL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: sub.city }),
  });

  if (!response.ok) {
    throw new Error(`city-intel returned ${response.status}`);
  }

  const intel = await response.json();

  await resend.emails.send({
    from: FROM_EMAIL,
    to: sub.email,
    subject: `Landalyze City Intel: ${sub.city} — ${new Date().toLocaleDateString('en-CA')}`,
    html: formatIntelEmail(sub.city, intel),
  });

  if (pool) {
    await pool.query('UPDATE subscriptions SET last_sent_at = NOW() WHERE id = $1', [sub.id]);
  }
}

// ─── Scheduled jobs ───────────────────────────────────────────────────────────

async function runDigestForFrequency(frequency) {
  if (!pool) return;
  const { rows } = await pool.query(
    'SELECT * FROM subscriptions WHERE active = TRUE AND frequency = $1',
    [frequency]
  );
  console.log(`[cron] ${frequency}: sending intel for ${rows.length} subscription(s)`);
  for (const sub of rows) {
    await sendCityIntel(sub).catch(err =>
      console.error(`[cron] failed for sub ${sub.id} (${sub.email}/${sub.city}):`, err.message)
    );
  }
}

cron.schedule('0 9 * * *',   () => runDigestForFrequency('daily'));    // 9 AM daily
cron.schedule('0 9 * * 1',   () => runDigestForFrequency('weekly'));   // 9 AM every Monday
cron.schedule('0 9 1 * *',   () => runDigestForFrequency('monthly'));  // 9 AM first of month

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'landalyze-backend' });
});

// POST /subscribe
// Body: { email, cities: string[], frequency: 'daily'|'weekly'|'monthly' }
app.post('/subscribe', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'subscriptions unavailable — database not connected' });

  const { email, cities, frequency } = req.body;

  if (!email || !cities || !frequency) {
    return res.status(400).json({ error: 'email, cities, and frequency are required' });
  }
  if (!Array.isArray(cities) || cities.length === 0) {
    return res.status(400).json({ error: 'cities must be a non-empty array' });
  }
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
    return res.status(400).json({ error: 'frequency must be daily, weekly, or monthly' });
  }

  const created = [];
  for (const city of cities) {
    const { rows } = await pool.query(
      'INSERT INTO subscriptions (email, city, frequency) VALUES ($1, $2, $3) RETURNING *',
      [email, city.trim(), frequency]
    );
    created.push(rows[0]);
  }

  res.json({ subscriptions: created });

  // Send initial intel for each city in the background
  for (const sub of created) {
    sendCityIntel(sub).catch(err =>
      console.error(`[subscribe] initial send failed for ${sub.email}/${sub.city}:`, err.message)
    );
  }
});

// GET /subscriptions?email=...
app.get('/subscriptions', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'subscriptions unavailable — database not connected' });
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query param required' });
  const { rows } = await pool.query(
    'SELECT * FROM subscriptions WHERE email = $1 AND active = TRUE',
    [email]
  );
  res.json({ subscriptions: rows });
});

// DELETE /subscriptions/:id
app.delete('/subscriptions/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'subscriptions unavailable — database not connected' });
  const { id } = req.params;
  const { rows } = await pool.query(
    'UPDATE subscriptions SET active = FALSE WHERE id = $1 RETURNING id',
    [Number(id)]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'subscription not found' });
  res.json({ cancelled: rows[0].id });
});

// POST /city-intel
// Body: { city }
app.post('/city-intel', async (req, res) => {
  try {
    const { city } = req.body;
    if (!city) return res.status(400).json({ error: 'city is required' });

    const messages = [
      {
        role: 'user',
        content: `You are a real estate intelligence analyst. Search for the latest news for ${city} across these 6 categories:

1. Recent zoning bylaw changes or proposals
2. City council decisions affecting land use or development
3. Development permit approvals, denials, or notable applications
4. CMHC updates or federal/provincial housing policy changes
5. Financing rate changes or mortgage market news
6. Community discussion (Reddit: r/canadahousing, r/PersonalFinanceCanada, local city subreddits)

Return a JSON object only — no markdown, no explanation:
{
  "city": "${city}",
  "digest": ["5 to 7 concise bullet points, each a single sentence with the key fact"],
  "sources": ["url1", "url2", ...]
}`
      }
    ];

    let response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    // Handle multi-turn web search
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = toolUseBlocks.map(tb => ({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: tb.type === 'tool_use' ? (tb.input?.query || '') : '',
      }));

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });
    }

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    const intel = match ? JSON.parse(match[0]) : { city, digest: [], sources: [] };

    res.json(intel);
  } catch (err) {
    console.error('/city-intel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /analyze
app.post('/analyze', async (req, res) => {
  try {
    const { property } = req.body;
    const p = property;

    const prompt = `You are a professional real estate development underwriter and feasibility analyst. Analyze this land deal and return a JSON object only — no markdown, no explanation, just the JSON.

PROPERTY DATA:
- Address: ${p.parcelAddress}, ${p.municipality}, ${p.province}, ${p.country}
- Lot Size: ${p.totalLotSize} m²
- Frontage: ${p.frontage || 'unknown'}m, Depth: ${p.depth || 'unknown'}m
- Purchase Price: ${p.currency} $${p.purchasePrice}
- Current Zoning: ${p.currentZoning || 'unknown'}
- Proposed Use: ${p.proposedUse || 'unknown'}
- Needs Rezoning: ${p.needsRezoning}
- Target Zoning: ${p.targetZoning || 'none'}
- Construction Type: ${p.constructionType || 'unknown'}
- Total Units: ${p.totalUnits || 'unknown'}
- Target Rent/Unit: ${p.targetRent || 'unknown'}
- DCC/Unit: ${p.dccPerUnit || 'unknown'}
- CAC/Unit: ${p.cacPerUnit || 'unknown'}
- Is Assembly: ${p.isAssembly}
- Country: ${p.country}

UNDERWRITING FRAMEWORK:
1. Estimate allowable units from zoning and lot size
2. MLI Select value = units x $250,000 CAD (Canada) or market value per unit (US)
3. Target total cost = units x $200,000 (20% delta from value)
4. Search current construction costs for ${p.municipality} for ${p.constructionType || 'wood frame'}: wood frame typically $180-250/sqft, concrete $280-380/sqft
5. Estimate hard costs = units x avg unit size x construction cost/sqft
6. Soft costs = 18% of hard costs
7. DCC/CAC = use provided values or search current rates for ${p.municipality}
8. Total project cost = land + hard costs + soft costs + DCC/CAC
9. MLI Select financing (Canada): 95% of total value, requires CMHC approval
10. Conventional financing: 80% loan to cost, 1.2x DSCR minimum
11. Recommended liquidity = 40% of total project cost
12. Due diligence budget = 1% of total value (mention DealCraft Inc. as a resource)
13. Search CMHC for current vacancy rates and average rents in ${p.municipality} (Canada) or local market data (US)
14. Search current mortgage/construction loan rates for ${p.country}
15. Grade A+ to F based on: does deal hit 20% delta, qualifies for MLI, clean environmental, as-of-right zoning

Return this exact JSON structure:
{
  "grade": "A+/A/B+/B/C+/C/D/F",
  "grade_rationale": "one sentence why",
  "deal_summary": "2-3 sentence plain English summary",
  "site": {
    "lot_size_sqft": 0,
    "lot_size_acres": 0,
    "estimated_units": 0,
    "density_basis": "zoning description"
  },
  "financials": {
    "land_cost": 0,
    "hard_costs": 0,
    "soft_costs": 0,
    "dcc_cac": 0,
    "total_project_cost": 0,
    "cost_per_unit": 0,
    "total_value_mli": 0,
    "value_per_unit": 250000,
    "delta_percent": 0,
    "delta_status": "hits target / below target / deal killer"
  },
  "financing": {
    "mli_select": {
      "available": true,
      "max_loan": 0,
      "loan_to_value": "95%",
      "equity_required": 0,
      "notes": ""
    },
    "conventional": {
      "max_loan": 0,
      "loan_to_value": "80%",
      "equity_required": 0,
      "dscr_required": "1.2x",
      "notes": ""
    },
    "recommended_liquidity": 0,
    "current_rates": ""
  },
  "market": {
    "vacancy_rate": "",
    "avg_rent_per_unit": 0,
    "noi_estimate": 0,
    "cap_rate_estimate": ""
  },
  "due_diligence": {
    "budget": 0,
    "note": "1% of total value recommended. DealCraft Inc. provides owner's rep and due diligence services at dealcraft.ca"
  },
  "red_flags": [],
  "next_steps": [],
  "disclaimer": "This Phase 1 analysis is preliminary only. All figures must be verified with qualified professionals before proceeding."
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'No JSON in response' });

    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('/analyze error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
await initDb();
app.listen(PORT, () => console.log(`Landalyze backend running on port ${PORT}`));
