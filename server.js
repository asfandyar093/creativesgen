require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

// ── FIREBASE ADMIN ─────────────────────────────────────────────────────────
let adminDb = null;
let adminAuth = null;
let adminFieldValue = null;
try {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
      console.log('✅  Firebase Admin SDK initialized');
    } else {
      console.warn('⚠️   FIREBASE_SERVICE_ACCOUNT not set — admin user updates disabled');
    }
  }
  if (admin.apps.length) {
    adminDb = admin.firestore();
    adminAuth = admin.auth();
    adminFieldValue = admin.firestore.FieldValue;
  }
} catch(e) {
  console.error('Firebase Admin init error:', e.message);
}

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

// ── FIRESTORE OTP STORE (works on Vercel serverless) ─────────────────────
const FIREBASE_PROJECT = 'image-generation-web-app';
const FIREBASE_API_KEY = 'AIzaSyCul5Hv4vy-FfH-IMafdOP3fs8ikP2WvIE';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function otpSet(email, code) {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const docId = email.toLowerCase().replace(/[.#$[\]/]/g, '_');
  await fetch(`${FS_BASE}/otps/${docId}?key=${FIREBASE_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        email: { stringValue: email.toLowerCase() },
        code: { stringValue: code },
        expiresAt: { integerValue: String(expiresAt) }
      }
    })
  });
}

async function otpGet(email) {
  const docId = email.toLowerCase().replace(/[.#$[\]/]/g, '_');
  const r = await fetch(`${FS_BASE}/otps/${docId}?key=${FIREBASE_API_KEY}`);
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.fields) return null;
  return {
    code: data.fields.code?.stringValue,
    expiresAt: parseInt(data.fields.expiresAt?.integerValue || 0)
  };
}

async function otpDelete(email) {
  const docId = email.toLowerCase().replace(/[.#$[\]/]/g, '_');
  await fetch(`${FS_BASE}/otps/${docId}?key=${FIREBASE_API_KEY}`, { method: 'DELETE' });
}

// ── /api/request-otp ─────────────────────────────────────────────────────
app.post('/api/request-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await otpSet(email, code);

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
app.post('/api/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  const stored = await otpGet((email || '').toLowerCase());
  if (!stored) return res.json({ valid: false, reason: 'No code found. Request a new one.' });
  if (Date.now() > stored.expiresAt) {
    await otpDelete(email);
    return res.json({ valid: false, reason: 'Code expired. Request a new one.' });
  }
  if (stored.code !== String(code).trim()) return res.json({ valid: false, reason: 'Incorrect code. Try again.' });
  await otpDelete(email); // single-use
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

function emailLimitTemplate(email, plan, used, allowance) {
  const planLabel = (plan||'free').charAt(0).toUpperCase()+(plan||'free').slice(1);
  const appUrl = process.env.APP_URL || 'https://creativesgen.com/app';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:32px;text-align:center">
    <div style="font-size:28px;margin-bottom:8px">⚡</div>
    <div style="color:#fff;font-size:1.3rem;font-weight:900">Creatives Gen</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    <h2 style="margin:0 0 12px;font-size:1.3rem;color:#0d1117">You've used all your images</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:0.9rem;line-height:1.6">
      You've reached your <strong>${planLabel} plan</strong> limit of <strong>${allowance} images</strong>. Upgrade your plan to keep creating.
    </p>
    <div style="background:#fef3c7;border-radius:10px;padding:16px 20px;margin-bottom:28px;text-align:center">
      <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#d97706;margin-bottom:4px">Images Used</div>
      <div style="font-size:2rem;font-weight:900;color:#0d1117">${used} / ${allowance}</div>
    </div>
    <a href="${appUrl}" style="display:block;background:linear-gradient(135deg,#5b5ef4,#ec4899);color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:800;font-size:0.95rem;margin-bottom:12px">Upgrade My Plan →</a>
    <p style="margin:0;color:#8b95a7;font-size:0.78rem;text-align:center">Questions? <a href="mailto:hello@creativesgen.com" style="color:#5b5ef4">hello@creativesgen.com</a></p>
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

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'cg-admin-2026-secure';
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
          generationConfig: { temperature: 0.9 }
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

// ── /api/admin/update-user ────────────────────────────────────────────────
app.post('/api/admin/update-user', async (req, res) => {
const { secret, uid, plan, imagesAllowance, imagesUsed, planRenewalDate } = req.body;
  if (secret !== 'cg-admin-2026-secure') return res.status(403).json({ error: 'Forbidden' });
  if (!uid) return res.status(400).json({ error: 'uid required' });

  if (!adminDb) {
    return res.status(503).json({ error: 'Firebase Admin SDK not configured. Add FIREBASE_SERVICE_ACCOUNT to Vercel environment variables.' });
  }

  try {
    const update = {};
    if (plan !== undefined) update.plan = plan;
    if (imagesAllowance !== undefined) update.imagesAllowance = imagesAllowance;
    if (imagesUsed !== undefined) update.imagesUsed = imagesUsed;
    if (planRenewalDate) update.planRenewalDate = new Date(planRenewalDate);

    await adminDb.collection('users').doc(uid).update(update);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ── /api/admin/quick-cancel ───────────────────────────────────────────────
app.post('/api/admin/quick-cancel', async (req, res) => {
  const { secret, uid } = req.body;
  if (secret !== 'cg-admin-2026-secure') return res.status(403).json({ error: 'Forbidden' });
  if (!uid) return res.status(400).json({ error: 'uid required' });
  if (!adminDb) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  try {
    await adminDb.collection('users').doc(uid).update({
      plan: 'free', imagesAllowance: 15, planRenewalDate: adminFieldValue.delete()
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ── /api/admin/update-admins ─────────────────────────────────────────────
app.post('/api/admin/update-admins', async (req, res) => {
  const { secret, emails } = req.body;
  if (secret !== 'cg-admin-2026-secure') return res.status(403).json({ error: 'Forbidden' });
  if (!adminDb) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  try {
    await adminDb.collection('config').doc('admins').set({ emails });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ── /api/admin/preauthorize ──────────────────────────────────────────────
app.post('/api/admin/preauthorize', async (req, res) => {
  const { secret, email, plan, note, addedBy } = req.body;
  if (secret !== 'cg-admin-2026-secure') return res.status(403).json({ error: 'Forbidden' });
  if (!adminDb) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  try {
    const docId = email.replace(/[.#$[\]]/g, '_');
    await adminDb.collection('preauth').doc(docId).set({
      email, plan, note: note || '', addedBy: addedBy || '',
      addedAt: adminFieldValue.serverTimestamp(),
      claimed: false
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ── /api/admin/delete-preauth ────────────────────────────────────────────
app.post('/api/admin/delete-preauth', async (req, res) => {
  const { secret, docId } = req.body;
  if (secret !== 'cg-admin-2026-secure') return res.status(403).json({ error: 'Forbidden' });
  if (!adminDb) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  try {
    await adminDb.collection('preauth').doc(docId).delete();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ── /api/user/sync — read/create user doc via Admin SDK (bypasses security rules) ──
app.post('/api/user/sync', async (req, res) => {
  if (!adminDb || !adminAuth) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const ref = adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      let plan = 'free', imagesAllowance = 15;
      const PLAN_ALLOWANCE = { free:15, starter:200, pro:1000, agency:5000, enterprise:15000 };
      try {
        const docId = email.toLowerCase().replace(/[.#$[\]]/g, '_');
        const pa = await adminDb.collection('preauth').doc(docId).get();
        if (pa.exists && !pa.data().claimed) {
          plan = pa.data().plan || 'free';
          imagesAllowance = PLAN_ALLOWANCE[plan] || 15;
          await adminDb.collection('preauth').doc(docId).update({ claimed: true, claimedAt: adminFieldValue.serverTimestamp(), claimedUid: uid });
        }
      } catch(e) {}
      const renewal = new Date(); renewal.setDate(renewal.getDate() + 30);
      await ref.set({ email, plan, imagesAllowance, imagesUsed: 0, imagesUsedAllTime: 0,
        createdAt: adminFieldValue.serverTimestamp(), lastLoginAt: adminFieldValue.serverTimestamp(),
        planRenewalDate: renewal });
      return res.json({ plan, imagesUsed: 0, imagesAllowance, imagesUsedAllTime: 0, planRenewalDate: renewal.toISOString() });
    } else {
      await ref.update({ lastLoginAt: adminFieldValue.serverTimestamp() });
      const d = snap.data();
      return res.json({
        plan: d.plan || 'free',
        imagesUsed: d.imagesUsed || 0,
        imagesAllowance: d.imagesAllowance || 15,
        imagesUsedAllTime: d.imagesUsedAllTime || 0,
        planRenewalDate: d.planRenewalDate?.toDate ? d.planRenewalDate.toDate().toISOString() : null
      });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── /api/user/consume — atomically increment imagesUsed, check limit, email if hit ──
const PLAN_ALLOWANCE = { free:15, starter:200, pro:1000, agency:5000, enterprise:15000 };
app.post('/api/user/consume', async (req, res) => {
  if (!adminDb || !adminAuth) return res.status(503).json({ error: 'Firebase Admin SDK not configured' });
  const { idToken, n, toolType } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  const count = parseInt(n) || 1;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const ref = adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    const d = snap.data();
    const oldUsed = d.imagesUsed || 0;
    const allowance = d.imagesAllowance || 15;
    const plan = d.plan || 'free';
    const newUsed = oldUsed + count;
    await ref.update({
      imagesUsed: adminFieldValue.increment(count),
      imagesUsedAllTime: adminFieldValue.increment(count)
    });
    try {
      await adminDb.collection('generations').add({
        userId: uid, userEmail: email, tool: toolType || 'unknown',
        count, plan, createdAt: adminFieldValue.serverTimestamp()
      });
    } catch(e) {}
    const limitReached = newUsed >= allowance;
    const justHitLimit = oldUsed < allowance && newUsed >= allowance;
    if (justHitLimit) {
      const mailer = getMailer();
      if (mailer && email) {
        mailer.sendMail({
          from: FROM(), to: email,
          subject: 'You\'ve reached your Creatives Gen image limit',
          html: emailLimitTemplate(email, plan, newUsed, allowance)
        }).catch(() => {});
      }
    }
    return res.json({ success: true, imagesUsed: newUsed, imagesAllowance: allowance, limitReached });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Creatives Gen  →  http://localhost:${PORT}`);
  console.log(`    Text model  : ${TEXT_MODEL}`);
  console.log(`    Image model : ${IMAGE_MODEL}`);
});
