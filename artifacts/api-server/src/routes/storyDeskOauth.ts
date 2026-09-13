import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const oauthScriptPath = fileURLToPath(new URL("./oauth.mjs", import.meta.url));

function escapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderPage(page: "login" | "callback" | "consent"): string {
  const titles = {
    login: "Sign in to Alex Story Desk",
    callback: "Finishing sign in",
    consent: "Authorize Alex Story Desk",
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>${titles[page]}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f1eb; color: #181817; }
      main { width: min(420px, calc(100vw - 40px)); background: #fff; border: 1px solid #d8d3ca; border-radius: 14px; padding: 32px; box-shadow: 0 12px 40px rgb(28 25 20 / 8%); }
      h1 { margin: 0 0 8px; font: 600 27px/1.15 Georgia, serif; }
      p { color: #5b5852; line-height: 1.5; }
      label { display: block; margin: 16px 0 6px; font-size: 14px; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; border: 1px solid #bbb5aa; border-radius: 8px; padding: 11px 12px; font: inherit; }
      button { border: 0; border-radius: 8px; padding: 11px 16px; font: 600 15px/1.2 inherit; cursor: pointer; }
      button.primary { width: 100%; margin-top: 18px; background: #181817; color: white; }
      button.secondary { background: #ece8df; color: #181817; }
      button.danger { background: transparent; color: #6b2a22; }
      button:disabled { opacity: .55; cursor: wait; }
      .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
      .divider { display: flex; align-items: center; gap: 10px; margin: 18px 0; color: #8a857c; font-size: 12px; }
      .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: #ddd8cf; }
      .status { min-height: 22px; margin-top: 14px; color: #6b2a22; font-size: 14px; }
      .scope { padding: 10px 12px; border-radius: 8px; background: #f4f1eb; margin-top: 8px; }
      .muted { font-size: 13px; color: #77726a; }
    </style>
  </head>
  <body data-page="${page}">
    <main id="app" aria-live="polite">
      <h1>${titles[page]}</h1>
      <p>Loading…</p>
    </main>
    <script type="module" src="/api/story-desk/oauth.js"></script>
  </body>
</html>`;
}

router.get("/story-desk/auth-config", (_req, res) => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    res.status(503).json({ error: "authentication_not_configured" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.type("json").send(escapeJson({ url, publishableKey }));
});

router.get("/story-desk/oauth.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("text/javascript").sendFile(oauthScriptPath);
});

router.get("/story-desk/login", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(renderPage("login"));
});

router.get("/story-desk/oauth/callback", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(renderPage("callback"));
});

router.get("/story-desk/oauth/consent", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(renderPage("consent"));
});

export default router;
