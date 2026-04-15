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
        content: `You are a land development feasibility analyst. Analyze this property and return JSON only with keys: grade (A+ to F), zone_summary, as_of_right (max_units, max_height, fsr), rezoning_
