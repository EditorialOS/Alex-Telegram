import { Router, type IRouter } from "express";
import {
  isOauthConfigured,
  getRedirectUri,
  signState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  saveInstallation,
  signSetupToken,
  verifySetupToken,
} from "../lib/alex/slackInstall.js";
import { updateTenantFile } from "../lib/alex/tenant.js";
import { markOnboarded } from "../lib/alex/telegramTenant.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f6f8;
    color: #1a1d23;
  }
  .card {
    width: min(92vw, 460px); padding: 44px 40px; border-radius: 18px;
    background: #ffffff;
    border: 1px solid #e6e8ec;
    box-shadow: 0 20px 50px -30px rgba(17,24,39,0.22);
    text-align: center;
  }
  .mark {
    font-size: 13px; letter-spacing: 0.28em; text-transform: uppercase;
    color: #9aa1ad; margin-bottom: 18px;
  }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; font-weight: 650; }
  p { color: #5b6471; line-height: 1.6; margin: 0 0 28px; font-size: 15px; }
  .btn {
    display: inline-flex; align-items: center; gap: 10px; text-decoration: none;
    background: #11151c; color: #fff; font-weight: 600; font-size: 15px;
    padding: 13px 22px; border-radius: 10px; transition: transform .08s ease, opacity .2s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn svg { width: 20px; height: 20px; }
  .hint { margin-top: 26px; font-size: 13px; color: #9aa1ad; }
  code { background: #f0f1f4; padding: 2px 6px; border-radius: 5px; font-size: 12px; }
  .ok { color: #16a34a; }
  .err { color: #dc2626; }
</style>
</head>
<body><main class="card">${bodyHtml}</main></body>
</html>`;
}

const slackGlyph = `<svg viewBox="0 0 122.8 122.8" aria-hidden="true"><path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A"/><path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/><path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/><path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E"/></svg>`;

// Branded landing page with the "Add to Slack" button. This is the shareable link.
router.get("/slack/landing", (_req, res): void => {
  if (!isOauthConfigured()) {
    res
      .status(503)
      .send(
        page(
          "Alex — not yet available",
          `<div class="mark">Alex · Editorial AI</div>
           <h1>Install isn't live yet</h1>
           <p>This Alex install link isn't configured yet. Check back shortly.</p>`
        )
      );
    return;
  }
  res.send(
    page(
      "Add Alex to Slack",
      `<div class="mark">Alex · Editorial AI</div>
       <h1>Add Alex to your Slack</h1>
       <p>Alex is your on-brand editorial teammate. Install it, then spend two minutes teaching Alex your voice — and start creating.</p>
       <a class="btn" href="/api/slack/install">${slackGlyph}<span>Add to Slack</span></a>
       <div class="hint">You'll be asked to approve permissions in your own Slack workspace.</div>`
    )
  );
});

// Kicks off OAuth: redirect to Slack's authorize screen with a signed state.
router.get("/slack/install", (_req, res): void => {
  if (!isOauthConfigured()) {
    res.status(503).send("Slack install is not configured.");
    return;
  }
  const url = buildAuthorizeUrl(getRedirectUri(), signState());
  res.redirect(url);
});

// OAuth callback: verify state, exchange the code, persist the installation,
// then send the installer straight into the arrival wizard (Order A).
router.get("/slack/oauth_redirect", async (req, res): Promise<void> => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const slackError = typeof req.query.error === "string" ? req.query.error : "";

  if (slackError) {
    res.status(400).send(
      page(
        "Install cancelled",
        `<div class="mark">Alex · Editorial AI</div>
         <h1 class="err">Install cancelled</h1>
         <p>The installation was cancelled or denied. You can <a class="btn" href="/api/slack/landing" style="margin-top:8px">try again</a></p>`
      )
    );
    return;
  }

  if (!verifyState(state)) {
    res.status(400).send(
      page(
        "Install failed",
        `<div class="mark">Alex · Editorial AI</div>
         <h1 class="err">Security check failed</h1>
         <p>This install link expired or was tampered with. Please start again from the install page.</p>`
      )
    );
    return;
  }

  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }

  try {
    const install = await exchangeCodeForToken(code, getRedirectUri());
    await saveInstallation(install);
    const token = signSetupToken(install.teamId);
    res.redirect(`/api/slack/setup?token=${encodeURIComponent(token)}`);
  } catch (err) {
    logger.error({ err }, "Slack OAuth exchange failed");
    res.status(500).send(
      page(
        "Install failed",
        `<div class="mark">Alex · Editorial AI</div>
         <h1 class="err">Something went wrong</h1>
         <p>We couldn't finish the installation. Please try again from the install page.</p>`
      )
    );
  }
});

function expiredSetupPage(): string {
  return page(
    "Setup link expired",
    `<div class="mark">Alex · Editorial AI</div>
     <h1 class="err">This setup link expired</h1>
     <p>No problem — Alex is already installed. You can set your brand up any time in Slack with <code>/alex-update brand-voice …</code>, or reinstall to run setup again.</p>
     <a class="btn" href="/api/slack/landing">Back to start</a>`
  );
}

// The arrival wizard. Token-gated to the workspace that just installed.
router.get("/slack/setup", (req, res): void => {
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  const teamId = verifySetupToken(token);
  if (!teamId || !token) {
    res.status(400).send(expiredSetupPage());
    return;
  }
  res.send(wizardPage(token));
});

// The brand fields the wizard collects, in display order. Each maps 1:1 to a
// tenant file — the same store /alex-update writes to.
const FIELD_DEFS: { key: string; label: string }[] = [
  { key: "brand-voice", label: "Brand voice" },
  { key: "audience-personas", label: "Audience personas" },
  { key: "content-pillars", label: "Content pillars" },
  { key: "style-guide", label: "Style guide" },
  { key: "competitive-landscape", label: "Competitive landscape" },
  { key: "standing-orders", label: "Standing orders" },
  { key: "teammate", label: "Name & persona" },
  { key: "drive-folder", label: "Google Drive folder" },
];

interface SetupBody {
  token?: string;
  fields?: Record<string, string>;
  /** Optional IANA timezone. Only meaningful for Telegram tenants (§4.4). */
  timezone?: string;
}

// Writes the brand fields the installer filled in, straight to the tenant store.
router.post("/slack/setup", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as SetupBody;
  const teamId = verifySetupToken(body.token);
  if (!teamId) {
    res.status(400).json({ ok: false, error: "This setup link expired. Reinstall to run setup again." });
    return;
  }

  const fields = body.fields ?? {};
  const get = (key: string): string =>
    typeof fields[key] === "string" ? fields[key].trim() : "";

  if (!get("brand-voice")) {
    res.status(400).json({
      ok: false,
      error: "Brand voice is the one field Alex really needs — add it to continue. Everything else is optional.",
    });
    return;
  }

  try {
    const saved: string[] = [];
    for (const def of FIELD_DEFS) {
      const value = get(def.key);
      if (!value) continue;
      const result = await updateTenantFile(teamId, def.key, value);
      if (result.success) saved.push(def.label);
    }
    if (saved.length === 0) {
      res.status(422).json({ ok: false, error: "Nothing was saved. Add your brand voice to continue." });
      return;
    }

    // Telegram tenants (tenant_ref "tg_<chat_id>") record onboarding completion
    // and their timezone on the telegram_tenants row (§4.4). Slack tenants have
    // no such row — the timezone field is simply ignored for them.
    if (teamId.startsWith("tg_")) {
      const chatId = Number(teamId.slice(3));
      const tz = typeof body.timezone === "string" ? body.timezone.trim() : "";
      if (Number.isFinite(chatId)) {
        await markOnboarded(chatId, tz || undefined);
      }
    }

    logger.info({ teamId, saved }, "Wizard onboarding complete");
    res.json({ ok: true, saved });
  } catch (err) {
    logger.error({ err, teamId }, "Wizard onboarding failed");
    res.status(500).json({ ok: false, error: "Something went wrong saving your brand. Please try again." });
  }
});

function wizardPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Welcome to Alex</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px 16px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f6f8;
    color: #1a1d23;
  }
  .card {
    width: min(94vw, 560px); padding: 40px; border-radius: 18px;
    background: #ffffff;
    border: 1px solid #e6e8ec;
    box-shadow: 0 20px 50px -30px rgba(17,24,39,0.22);
  }
  .mark { font-size: 13px; letter-spacing: 0.28em; text-transform: uppercase; color: #9aa1ad; margin-bottom: 16px; }
  h1 { font-size: 27px; line-height: 1.2; margin: 0 0 10px; font-weight: 650; }
  .lede { color: #5b6471; line-height: 1.6; margin: 0 0 28px; font-size: 15px; }
  label { display: block; font-size: 14px; font-weight: 600; margin: 22px 0 6px; }
  .sub { font-weight: 400; color: #9aa1ad; font-size: 13px; }
  .star { color: #eab308; }
  textarea, input[type=text], input[type=url] {
    width: 100%; background: #fff; color: #1a1d23;
    border: 1px solid #d9dce1; border-radius: 10px;
    padding: 12px 14px; font-size: 14px; font-family: inherit; resize: vertical;
  }
  textarea::placeholder, input::placeholder { color: #aab0ba; }
  textarea:focus, input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
  textarea { min-height: 92px; }
  .btn {
    margin-top: 28px; width: 100%; border: none; cursor: pointer;
    background: #11151c; color: #fff; font-weight: 650; font-size: 15px;
    padding: 14px 20px; border-radius: 10px; transition: transform .08s ease, opacity .2s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn:disabled { opacity: .55; cursor: default; transform: none; }
  .skip { display: block; text-align: center; margin-top: 18px; font-size: 13px; color: #9aa1ad; }
  .skip a { color: #2563eb; }
  .err { color: #dc2626; font-size: 14px; margin-top: 16px; min-height: 18px; }
  .center { text-align: center; }
  .check { list-style: none; padding: 0; margin: 22px 0 0; text-align: left; display: inline-block; }
  .check li { font-size: 16px; margin: 10px 0; color: #2b2f37; }
  .check .ok { color: #16a34a; margin-right: 8px; }
  .cmds { background: #f6f7f9; border: 1px solid #eceef1; border-radius: 12px; padding: 16px 18px; margin-top: 24px; text-align: left; }
  .cmds code { display: inline-block; background: #eef0f3; padding: 3px 8px; border-radius: 6px; font-size: 13px; margin: 4px 6px 4px 0; }
  .spin { width: 26px; height: 26px; border: 3px solid rgba(17,24,39,0.12); border-top-color: #11151c; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 8px auto 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<main class="card">
  <div id="stage-form">
    <div class="mark">Alex · Editorial AI</div>
    <h1>Set up Alex 👋</h1>
    <p class="lede">Teach Alex your brand. Brand voice is the only field that really matters — fill in as many of the rest as you like. You can change any of this later in Slack with <code>/alex-update</code>.</p>

    <label>Step 1 · Brand voice <span class="star">⭐</span> <span class="sub">— how your brand sounds; tone, personality, words you avoid.</span></label>
    <textarea id="brand-voice" placeholder="We're a sharp, optimistic editorial brand covering the future of media. Tone: confident, plainspoken, a little irreverent — never corporate or hype-y. We write like a smart friend who's done the reading: short punchy sentences, concrete examples, no buzzwords like &quot;synergy&quot; or &quot;game-changer.&quot; American English, Oxford comma."></textarea>

    <label>Step 2 · Audience personas <span class="sub">— who you're writing for.</span></label>
    <textarea id="audience-personas" placeholder="Primary: media &amp; marketing pros aged 28–45 who follow trends closely and are short on time — smart, busy, allergic to fluff. Secondary: founders building media brands who want practical insight they can act on today. Assume they know the basics — don't over-explain."></textarea>

    <label>Step 3 · Content pillars <span class="sub">— the core topics you cover.</span></label>
    <textarea id="content-pillars" placeholder="1) The future of journalism &amp; AI in newsrooms.&#10;2) Media business models — subscriptions, ads, creator economy.&#10;3) Audience growth &amp; engagement tactics.&#10;4) Tools &amp; workflows for modern media teams."></textarea>

    <label>Step 4 · Style guide <span class="sub">— formatting &amp; rules.</span></label>
    <textarea id="style-guide" placeholder="Headlines: sentence case, no clickbait, under 70 characters.&#10;Captions: 1–3 short paragraphs, max 2 emoji, 3–5 hashtags at the end.&#10;Never ALL CAPS. Use em dashes. Spell out numbers under 10. End posts with a clear CTA or a question."></textarea>

    <label>Step 5 · Competitive landscape <span class="sub">(optional) — who you're up against &amp; your edge.</span></label>
    <textarea id="competitive-landscape" placeholder="Main competitors: Competitor A (strong on breaking news, weak on analysis), Competitor B (great newsletters, thin on social). Our edge: sharper opinions, faster takes, and a more human voice."></textarea>

    <label>Step 6 · Standing orders <span class="sub">(optional) — recurring campaigns or themes to keep in mind.</span></label>
    <textarea id="standing-orders" placeholder="Running a &quot;Future of Newsrooms&quot; series every Tuesday through August — tie content to it when it fits. Promoting our industry report (drops July 1). Always nudge readers toward the newsletter signup."></textarea>

    <label>Step 7 · Name &amp; persona <span class="sub">(optional) — rename Alex; put the name on the first line as Name: …</span></label>
    <textarea id="teammate" placeholder="Name: Jordan&#10;You're our senior editor — warm but exacting, 15 years in digital media. You push for clarity and never let a weak headline slide."></textarea>

    <label>Step 8 · Google Drive folder <span class="sub">(optional) — folder ID for auto-filing approved output.</span></label>
    <input id="drive-folder" type="text" placeholder="1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv" />

    <label>Step 9 · Your timezone <span class="sub">(optional) — when scheduled drops go out. Defaults to Pacific.</span></label>
    <select id="timezone">
      <option value="">Pacific — America/Los_Angeles (default)</option>
      <option value="America/Denver">Mountain — America/Denver</option>
      <option value="America/Chicago">Central — America/Chicago</option>
      <option value="America/New_York">Eastern — America/New_York</option>
      <option value="America/Anchorage">Alaska — America/Anchorage</option>
      <option value="Pacific/Honolulu">Hawaii — Pacific/Honolulu</option>
      <option value="Europe/London">London — Europe/London</option>
      <option value="Europe/Paris">Central Europe — Europe/Paris</option>
      <option value="Asia/Singapore">Singapore — Asia/Singapore</option>
      <option value="Australia/Sydney">Sydney — Australia/Sydney</option>
    </select>

    <button id="go" class="btn">Save my brand</button>
    <div id="err" class="err"></div>
    <span class="skip">Prefer Slack? <a href="#" id="skip">Skip — set up later with /alex-update</a></span>
  </div>

  <div id="stage-loading" class="center" style="display:none">
    <div class="mark">Alex · Editorial AI</div>
    <h1>Saving your brand…</h1>
    <p class="lede">Setting up your editorial profile.</p>
    <div class="spin"></div>
  </div>

  <div id="stage-done" class="center" style="display:none">
    <div class="mark">Alex · Editorial AI</div>
    <h1 class="ok">You're ready 🎉</h1>
    <p class="lede">I've saved your editorial profile. Here's what's set:</p>
    <ul id="check" class="check"></ul>
    <div class="cmds">
      <strong style="font-size:14px">Head to Slack and try:</strong><br/>
      <code>/brief [your idea]</code>
      <code>/morning-briefing</code>
      <code>/weekly-social</code>
    </div>
    <p class="lede" style="margin-top:22px; font-size:13px; color:#6b7587">Want to fine-tune? Use <code>/alex-update</code> in Slack any time.</p>
  </div>
</main>

<script>
  var TOKEN = ${JSON.stringify(token)};
  var FIELD_KEYS = ["brand-voice","audience-personas","content-pillars","style-guide","competitive-landscape","standing-orders","teammate","drive-folder"];
  var goEl = document.getElementById('go');
  var errEl = document.getElementById('err');
  var skipEl = document.getElementById('skip');

  function show(id) {
    document.getElementById('stage-form').style.display = id === 'form' ? 'block' : 'none';
    document.getElementById('stage-loading').style.display = id === 'loading' ? 'block' : 'none';
    document.getElementById('stage-done').style.display = id === 'done' ? 'block' : 'none';
  }

  function renderDone(saved) {
    var ul = document.getElementById('check');
    ul.innerHTML = '';
    (saved || []).forEach(function (label) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.className = 'ok';
      span.textContent = '✓';
      li.appendChild(span);
      li.appendChild(document.createTextNode(label));
      ul.appendChild(li);
    });
    show('done');
  }

  skipEl.addEventListener('click', function (e) {
    e.preventDefault();
    renderDone(['Alex installed — set your brand any time with /alex-update']);
  });

  goEl.addEventListener('click', function () {
    errEl.textContent = '';
    var fields = {};
    FIELD_KEYS.forEach(function (k) {
      var el = document.getElementById(k);
      if (el) fields[k] = el.value.trim();
    });
    if (!fields['brand-voice']) {
      errEl.textContent = 'Brand voice is the one field Alex really needs — add it to continue.';
      var bv = document.getElementById('brand-voice');
      if (bv) bv.focus();
      return;
    }
    var tzEl = document.getElementById('timezone');
    var timezone = tzEl ? tzEl.value : '';
    goEl.disabled = true;
    show('loading');
    fetch('/api/slack/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, fields: fields, timezone: timezone })
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        renderDone(res.data.saved);
      } else {
        goEl.disabled = false;
        show('form');
        errEl.textContent = (res.data && res.data.error) || 'Something went wrong. Please try again.';
      }
    }).catch(function () {
      goEl.disabled = false;
      show('form');
      errEl.textContent = 'Network error. Please try again.';
    });
  });
</script>
</body>
</html>`;
}

export default router;
