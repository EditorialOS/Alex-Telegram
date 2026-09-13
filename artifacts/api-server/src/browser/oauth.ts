/// <reference lib="dom" />

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AuthConfig = { url: string; publishableKey: string };

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) throw new Error("Missing application root");
const app: HTMLElement = appElement;

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/api/story-desk/oauth/consent";
  return raw;
}

function showError(error: unknown): void {
  const status = document.querySelector<HTMLElement>("#status");
  const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  if (status) status.textContent = message;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function loadClient(): Promise<SupabaseClient> {
  const response = await fetch("/api/story-desk/auth-config", { cache: "no-store" });
  if (!response.ok) throw new Error("Alex sign-in is not configured yet.");
  const config = await response.json() as AuthConfig;
  return createClient(config.url, config.publishableKey, {
    // Magic links are commonly opened from a mail client into a different
    // browser context. The implicit flow keeps the one-time link portable;
    // ChatGPT's separate OAuth exchange still uses PKCE at the authorization
    // server boundary.
    auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true },
  });
}

async function renderLogin(client: SupabaseClient): Promise<void> {
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const { data: { session } } = await client.auth.getSession();
  if (session) {
    location.replace(next);
    return;
  }

  app.innerHTML = `
    <h1>Sign in to Alex Story Desk</h1>
    <p>Use the private Alex account. Your password stays with Supabase.</p>
    <form id="password-form">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="primary" type="submit">Sign in</button>
    </form>
    <div class="divider">or</div>
    <form id="magic-form">
      <label for="magic-email">Email</label>
      <input id="magic-email" name="email" type="email" autocomplete="email" required>
      <button class="secondary" style="width:100%;margin-top:12px" type="submit">Email me a sign-in link</button>
    </form>
    <p id="status" class="status"></p>`;

  document.querySelector<HTMLFormElement>("#password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const { error } = await client.auth.signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) return showError(error);
    location.assign(next);
  });

  document.querySelector<HTMLFormElement>("#magic-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    localStorage.setItem("alex-oauth-next", next);
    const callback = new URL("/api/story-desk/oauth/callback", location.origin);
    callback.searchParams.set("next", next);
    const { error } = await client.auth.signInWithOtp({
      email: String(form.get("email") ?? ""),
      options: { emailRedirectTo: callback.toString() },
    });
    if (error) return showError(error);
    const status = document.querySelector<HTMLElement>("#status");
    if (status) status.textContent = "Check your email for the private sign-in link.";
  });
}

async function renderCallback(client: SupabaseClient): Promise<void> {
  app.innerHTML = "<h1>Finishing sign in</h1><p>Please wait…</p><p id=\"status\" class=\"status\"></p>";
  const { data: { session }, error } = await client.auth.getSession();
  if (error) return showError(error);
  if (!session) return showError(new Error("The sign-in link is invalid or expired."));
  const callbackNext = new URLSearchParams(location.search).get("next");
  const next = safeNext(callbackNext ?? localStorage.getItem("alex-oauth-next"));
  localStorage.removeItem("alex-oauth-next");
  location.replace(next);
}

async function renderConsent(client: SupabaseClient): Promise<void> {
  const authorizationId = new URLSearchParams(location.search).get("authorization_id");
  if (!authorizationId) throw new Error("This authorization request is missing its ID.");

  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    location.replace(`/api/story-desk/login?next=${encodeURIComponent(next)}`);
    return;
  }

  const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) throw error ?? new Error("This authorization request is invalid or expired.");
  if (!("authorization_id" in data)) {
    location.replace(data.redirect_url);
    return;
  }

  const scopes = data.scope?.trim().split(/\s+/).filter(Boolean) ?? [];
  app.innerHTML = `
    <h1>Authorize ${escapeHtml(data.client.name)}</h1>
    <p>Allow this private ChatGPT connection to use Alex Story Desk on your behalf.</p>
    <p class="muted">Requested permissions</p>
    <div class="scope">${scopes.length ? scopes.map((scope) => `<div>${escapeHtml(scope)}</div>`).join("") : "Basic account access"}</div>
    <div class="actions">
      <button id="deny" class="danger" type="button">Deny</button>
      <button id="approve" class="secondary" type="button">Allow</button>
    </div>
    <p id="status" class="status"></p>`;

  document.querySelector("#approve")?.addEventListener("click", async () => {
    const { data: decision, error: decisionError } = await client.auth.oauth.approveAuthorization(authorizationId);
    if (decisionError || !decision) return showError(decisionError);
    location.assign(decision.redirect_url);
  });
  document.querySelector("#deny")?.addEventListener("click", async () => {
    const { data: decision, error: decisionError } = await client.auth.oauth.denyAuthorization(authorizationId);
    if (decisionError || !decision) return showError(decisionError);
    location.assign(decision.redirect_url);
  });
}

async function main(): Promise<void> {
  const client = await loadClient();
  const page = document.body.dataset.page;
  if (page === "login") return renderLogin(client);
  if (page === "callback") return renderCallback(client);
  if (page === "consent") return renderConsent(client);
  throw new Error("Unknown authorization page.");
}

main().catch((error) => {
  app.innerHTML = `<h1>Alex Story Desk</h1><p id="status" class="status"></p>`;
  showError(error);
});
