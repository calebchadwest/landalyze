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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a land development feasibility analyst. Analyze this property and return JSON only with keys: grade (A+ to F), zone_summary, as_of_right (max_units, max_height, fsr), rezoning_potential, red_flags array, what_buyer_needs (min_equity, min_net_worth), disclaimer. Property: ${JSON.stringify(property)}`
      }]
    });
    res.json({ result: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Landalyze backend running on port ${PORT}`));
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = readFileSync(resolve(__dirname, '.env'), 'utf8');
envFile.split('\n').forEach(line => {
  const [key, val] = line.split('=');
  if (key && val) process.env[key.trim()] = val.trim();
});

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'landalyze-backend' });
});

app.post('/analyze', async (req, res) => {
  try {
    const { property } = req.body;
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a land development feasibility analyst. Analyze this property and return JSON only with keys: grade (A+ to F), zone_summary, as_of_right (max_units, max_height, fsr), rezoning_potential, red_flags array, what_buyer_needs (min_equity, min_net_worth), disclaimer. Property: ${JSON.stringify(property)}`
      }]
    });
    res.json({ result: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Landalyze backend running on port ${PORT}`));
