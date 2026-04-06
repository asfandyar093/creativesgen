require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));

// Redirect /page.html → /page (clean URLs)
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const clean = req.path.slice(0, -5) || '/';
    return res.redirect(301, clean);
  }
  next();
});

// Serve static files, fallback to .html extension
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const TEXT_MODEL  = process.env.TEXT_MODEL  || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-2.5-flash-image';

if (!GEMINI_KEY) {
  console.error('❌  GEMINI_API_KEY is not set. Create a .env file. See .env.example');
  process.exit(1);
}

// ── Text: plan slides / regen ──────────────────────────────────────────────
app.post('/api/plan', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, responseMimeType: 'application/json' }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Image generation ───────────────────────────────────────────────────────
app.post('/api/image', async (req, res) => {
  const { prompt, model, aspectRatio, logoParts } = req.body;
  const useModel = (model || IMAGE_MODEL).trim();
  const isGemini = useModel.startsWith('gemini-');

  try {
    let r, data;

    if (isGemini) {
      const parts = [];
      // Attach logo image for multimodal context if provided
      if (Array.isArray(logoParts) && logoParts.length) {
        logoParts.forEach(p => parts.push({ inlineData: p }));
      }
      parts.push({ text: prompt });

      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
          })
        }
      );
    } else {
      // Imagen predict API
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:predict?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio || '1:1' }
          })
        }
      );
    }

    data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({ ...data, _model: useModel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Creatives Gen  →  http://localhost:${PORT}`);
  console.log(`    Text model  : ${TEXT_MODEL}`);
  console.log(`    Image model : ${IMAGE_MODEL}`);
});
