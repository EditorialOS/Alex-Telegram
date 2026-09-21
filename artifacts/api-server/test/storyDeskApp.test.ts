import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

process.env.NODE_ENV = "production";
process.env.DATABASE_URL = "postgres://alex:alex@127.0.0.1:1/alex";
process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
process.env.STORY_DESK_DOWNLOAD_SECRET =
  "test-download-secret-with-at-least-32-characters";
process.env.STORY_DESK_RESOURCE_URL = "https://alex.example.test/api/mcp";
process.env.SUPABASE_AUTH_ISSUER = "https://auth.example.test";
process.env.SUPABASE_URL = "https://project.example.test";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

test("the narrow deployment app exposes Story Desk and omits legacy routes", async (context) => {
  const { createStoryDeskApp } = await import("../src/storyDeskApp.js");
  const app = createStoryDeskApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  const health = await fetch(`${origin}/api/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const metadata = await fetch(
    `${origin}/.well-known/oauth-protected-resource`,
  );
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), {
    resource: "https://alex.example.test/api/mcp",
    authorization_servers: ["https://auth.example.test"],
    scopes_supported: ["email"],
    bearer_methods_supported: ["header"],
  });

  const pathMetadata = await fetch(
    `${origin}/.well-known/oauth-protected-resource/api/mcp`,
  );
  assert.equal(pathMetadata.status, 200);
  assert.deepEqual(await pathMetadata.json(), {
    resource: "https://alex.example.test/api/mcp",
    authorization_servers: ["https://auth.example.test"],
    scopes_supported: ["email"],
    bearer_methods_supported: ["header"],
  });

  const browserAsset = await fetch(`${origin}/story-desk/oauth.js`);
  assert.equal(browserAsset.status, 200);
  assert.match(browserAsset.headers.get("content-type") ?? "", /javascript/);

  const mcpWithoutToken = await fetch(`${origin}/api/mcp`);
  assert.equal(mcpWithoutToken.status, 401);
  assert.match(
    mcpWithoutToken.headers.get("www-authenticate") ?? "",
    /resource_metadata=/,
  );

  const preflight = await fetch(`${origin}/api/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://chatgpt.com",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

  const login = await fetch(`${origin}/api/story-desk/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /\/story-desk\/oauth\.js/);

  const authConfig = await fetch(`${origin}/api/story-desk/auth-config`);
  assert.equal(authConfig.status, 200);
  assert.deepEqual(await authConfig.json(), {
    url: "https://project.example.test",
    publishableKey: "test-publishable-key",
  });

  for (const request of [
    { pathname: "/api/admin", method: "GET" },
    { pathname: "/api/slack/health", method: "GET" },
    { pathname: "/api/telegram/webhook", method: "POST" },
  ]) {
    const response = await fetch(`${origin}${request.pathname}`, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: request.method === "POST" ? "{}" : undefined,
    });
    assert.equal(response.status, 404, request.pathname);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
});
