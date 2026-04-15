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
      messages: [{ role: 'user', content: 'Analyze this land deal and return JSON only. Keys: grade, zone_summary, as_of_right, rezoning_potential, red_flags, what_buyer_needs, disclaimer. Property: ' + JSON.stringify(property) }]
    });
    res.json({ result: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Landalyze backend running on port ' + PORT));