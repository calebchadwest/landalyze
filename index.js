import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'landalyze-backend' });
});

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
      .filter(b => b.type === 'te