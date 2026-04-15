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

app.post('/city-intel', async (req, res) => {
  try {
    const { city, frequency } = req.body;
    if (!city || !['daily', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ error: 'city (string) and frequency (daily/weekly/monthly) are required' });
    }

    const prompt = `You are a Canadian real estate and land development intelligence analyst. Search the web for the latest updates about ${city}.

Find and summarize the following for a ${frequency} digest:
1. Recent zoning bylaw changes or proposals in ${city}
2. City council decisions affecting land use or development
3. Development permit approvals, denials, or notable applications in ${city}
4. CMHC updates or federal/provincial housing policy news affecting ${city}
5. Financing rate changes or mortgage news affecting real estate in ${city}
6. Relevant Reddit discussions (r/canadahousing, r/PersonalFinanceCanada, or local ${city} subreddits)

Write exactly 5-7 bullet points (each starting with "- "). Include specific dates, numbers, and details wherever available.

After the bullets, list every source URL you used, one per line, each starting with "SOURCE: ".`;

    const tools = [{ type: 'web_search_20260209', name: 'web_search' }];
    const messages = [{ role: 'user', content: prompt }];

    let response;
    while (true) {
      const stream = client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 8000,
        tools,
        messages,
      });
      response = await stream.finalMessage();
      if (response.stop_reason !== 'pause_turn') break;
      // Web search hit its iteration limit — append and continue
      messages.push({ role: 'assistant', content: response.content });
    }

    // Collect all text blocks from the final response
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Parse bullet points
    const digest = lines
      .filter(l => /^[-•*]\s/.test(l))
      .map(l => l.replace(/^[-•*]\s+/, '').trim())
      .slice(0, 7);

    // Parse SOURCE: lines Claude was asked to emit
    const textSources = lines
      .filter(l => /^source:\s/i.test(l))
      .map(l => l.replace(/^source:\s+/i, '').trim());

    // Also extract URLs from any web search result blocks in all messages + final response
    const blockUrls = [];
    const allContent = [
      ...messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])),
      ...response.content,
    ];
    for (const block of allContent) {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item?.url) blockUrls.push(item.url);
        // One level deeper for nested result arrays
        for (const nested of Array.isArray(item?.content) ? item.content : []) {
          if (nested?.url) blockUrls.push(nested.url);
        }
      }
    }

    const sources = [...new Set([...textSources, ...blockUrls])].filter(
      u => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'))
    );

    res.json({ city, frequency, digest, sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Landalyze backend running on port ' + PORT));