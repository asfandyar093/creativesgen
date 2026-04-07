require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── EMAIL TRANSPORT ────────────────────────────────────────────────────────
function getMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
const FROM = () => `"Creatives Gen" <${process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@creativesgen.com'}>`;

// ── IN-MEMORY OTP STORE ───────────────────────────────────────────────────
// { email → { code, expiresAt } }
const otpStore = new Map();
setInterval(() => { // prune expired OTPs every 15 min
  const now = Date.now();
  for (const [k, v] of otpStore) if (now > v.expiresAt) otpStore.delete(k);
}, 15 * 60 * 1000);

// ── /api/request-otp ─────────────────────────────────────────────────────
app.post('/api/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + 10 * 60 * 1000 });

  const mailer = getMailer();
  if (!mailer) {
    console.log(`\n📧  OTP for ${email}: ${code}  (no SMTP configured — printed to console)\n`);
    return res.json({ sent: true, dev: true });
  }
  try {
    await mailer.sendMail({
      from: FROM(),
      to: email,
      subject: 'Your Creatives Gen verification code',
      html: emailOtpTemplate(code)
    });
    res.json({ sent: true });
  } catch (e) {
    console.error('Email send error:', e.message);
    res.status(500).json({ error: 'Could not send email: ' + e.message });
  }
});

// ── /api/verify-otp ──────────────────────────────────────────────────────
app.post('/api/verify-otp', (req, res) => {
  const { email, code } = req.body;
  const stored = otpStore.get((email || '').toLowerCase());
  if (!stored) return res.json({ valid: false, reason: 'No code found. Request a new one.' });
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email.toLowerCase());
    return res.json({ valid: false, reason: 'Code expired. Request a new one.' });
  }
  if (stored.code !== String(code).trim()) return res.json({ valid: false, reason: 'Incorrect code. Try again.' });
  otpStore.delete(email.toLowerCase()); // single-use
  res.json({ valid: true });
});

// ── /api/send-invite ─────────────────────────────────────────────────────
app.post('/api/send-invite', async (req, res) => {
  const { email, plan, note } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const mailer = getMailer();
  if (!mailer) {
    console.log(`\n📧  Invite for ${email} (plan: ${plan}) — no SMTP configured\n`);
    return res.json({ sent: true, dev: true });
  }
  try {
    await mailer.sendMail({
      from: FROM(),
      to: email,
      subject: 'Your Creatives Gen access is ready',
      html: emailInviteTemplate(email, plan, note)
    });
    res.json({ sent: true });
  } catch (e) {
    console.error('Invite email error:', e.message);
    res.status(500).json({ error: 'Could not send email: ' + e.message });
  }
});

// ── EMAIL TEMPLATES ──────────────────────────────────────────────────────
function emailOtpTemplate(code) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#5b5ef4,#ec4899);padding:32px;text-align:center">
    <div style="font-size:28px;margin-bottom:8px">✨</div>
    <div style="color:#fff;font-size:1.3rem;font-weight:900">Creatives Gen</div>
  </td></tr>
  <tr><td style="padding:36px 40px;text-align:center">
    <h2 style="margin:0 0 8px;font-size:1.3rem;color:#0d1117">Your verification code</h2>
    <p style="margin:0 0 28px;color:#5a6478;font-size:0.9rem">Enter this code in the app to verify your email and create your account.</p>
    <div style="display:inline-block;background:#eef0ff;border:2px solid #c4c8fb;border-radius:14px;padding:18px 40px;margin-bottom:28px">
      <div style="font-size:2.4rem;font-weight:900;letter-spacing:10px;color:#5b5ef4">${code}</div>
    </div>
    <p style="margin:0;color:#8b95a7;font-size:0.78rem">This code expires in <strong>10 minutes</strong>. Don't share it with anyone.</p>
  </td></tr>
  <tr><td style="padding:16px 40px 32px;text-align:center;border-top:1px solid #eee">
    <p style="margin:0;color:#8b95a7;font-size:0.75rem">If you didn't request this, you can safely ignore this email.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function emailInviteTemplate(email, plan, note) {
  const planLabel = (plan||'starter').charAt(0).toUpperCase()+(plan||'starter').slice(1);
  const signupUrl = process.env.APP_URL || 'https://creativesgen.com/app';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#5b5ef4,#ec4899);padding:32px;text-align:center">
    <div style="font-size:28px;margin-bottom:8px">✨</div>
    <div style="color:#fff;font-size:1.3rem;font-weight:900">Creatives Gen</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    <h2 style="margin:0 0 12px;font-size:1.3rem;color:#0d1117">Your access is ready!</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:0.9rem;line-height:1.6">
      You've been granted <strong>${planLabel} plan</strong> access to Creatives Gen — AI-powered image generation for social media, ads, and websites.
    </p>
    ${note ? `<div style="background:#eef0ff;border-left:4px solid #5b5ef4;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:0.82rem;color:#5b5ef4">${note}</div>` : ''}
    <div style="background:#ecfdf5;border-radius:10px;padding:16px 20px;margin-bottom:28px">
      <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#059669;margin-bottom:6px">Your plan</div>
      <div style="font-size:1.1rem;font-weight:900;color:#0d1117">${planLabel}</div>
    </div>
    <p style="margin:0 0 20px;color:#374151;font-size:0.9rem">Sign up with <strong>${email}</strong> to activate your plan automatically:</p>
    <a href="${signupUrl}" style="display:block;background:linear-gradient(135deg,#5b5ef4,#ec4899);color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:800;font-size:0.95rem">Get Started →</a>
  </td></tr>
  <tr><td style="padding:16px 40px 32px;text-align:center;border-top:1px solid #eee">
    <p style="margin:0;color:#8b95a7;font-size:0.75rem">Use the same email (${email}) when signing up so your plan is applied automatically.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

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
