import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ClientRecord } from "./contracts.js";
import { StoryDeskError } from "./errors.js";
import type { StoryDeskStore } from "./store.js";

export const STORY_DESK_OAUTH_SCOPES = ["email"] as const;

export interface StoryDeskOAuthIdentity {
  subject: string;
  oauthClientId: string;
}

export interface StoryDeskTokenVerifier {
  verify(token: string): Promise<StoryDeskOAuthIdentity>;
}

export interface StoryDeskRequest extends Request {
  storyDeskClient?: ClientRecord;
  storyDeskIdentity?: StoryDeskOAuthIdentity;
}

interface OAuthConfig {
  issuer: string;
  resource: string;
  jwksUrl: string;
}

function requiredHttpsUrl(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new StoryDeskError("authentication_not_configured", `${name} is required.`, 503);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new StoryDeskError("authentication_not_configured", `${name} must be an absolute URL.`, 503);
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new StoryDeskError("authentication_not_configured", `${name} must use HTTPS in production.`, 503);
  }
  return parsed.href.replace(/\/$/, "");
}

export function storyDeskOAuthConfig(): OAuthConfig {
  const issuer = requiredHttpsUrl("SUPABASE_AUTH_ISSUER");
  const resource = requiredHttpsUrl("STORY_DESK_RESOURCE_URL");
  const configuredJwks = process.env.STORY_DESK_OAUTH_JWKS_URL?.trim();
  const jwksUrl = configuredJwks
    ? requiredHttpsUrl("STORY_DESK_OAUTH_JWKS_URL")
    : `${issuer}/.well-known/jwks.json`;
  return { issuer, resource, jwksUrl };
}

export function storyDeskResourceMetadata() {
  const { issuer, resource } = storyDeskOAuthConfig();
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...STORY_DESK_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

function resourceMetadataUrl(resource: string): string {
  return new URL("/.well-known/oauth-protected-resource", resource).href;
}

export class SupabaseOAuthTokenVerifier implements StoryDeskTokenVerifier {
  private readonly config: OAuthConfig;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config = storyDeskOAuthConfig()) {
    this.config = config;
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  }

  async verify(token: string): Promise<StoryDeskOAuthIdentity> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.resource,
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new StoryDeskError("unauthorized", "The OAuth token has no subject.", 401);
    }
    if (typeof payload.client_id !== "string" || !payload.client_id) {
      throw new StoryDeskError("unauthorized", "A Supabase OAuth client token is required.", 401);
    }
    return { subject: payload.sub, oauthClientId: payload.client_id };
  }
}

function challenge(res: Response, resource: string, description: string): void {
  const metadata = resourceMetadataUrl(resource);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadata}", error="invalid_token", error_description="${description}"`,
  );
  res.status(401).json({ error: "unauthorized" });
}

export function storyDeskAuth(store: StoryDeskStore, verifier?: StoryDeskTokenVerifier) {
  let activeVerifier = verifier;
  return async (req: StoryDeskRequest, res: Response, next: NextFunction): Promise<void> => {
    let config: OAuthConfig;
    try {
      config = storyDeskOAuthConfig();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "OAuth is not configured.";
      res.status(503).json({ error: "authentication_not_configured", message: detail });
      return;
    }

    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      challenge(res, config.resource, "A valid Supabase OAuth token is required");
      return;
    }
    let identity: StoryDeskOAuthIdentity;
    try {
      activeVerifier ??= new SupabaseOAuthTokenVerifier(config);
      identity = await activeVerifier.verify(match[1].trim());
    } catch {
      challenge(res, config.resource, "The OAuth token is invalid or expired");
      return;
    }
    try {
      const client = await store.authenticateOAuthIdentity(identity.subject, identity.oauthClientId);
      if (!client) {
        challenge(res, config.resource, "This Supabase identity is not enrolled for this private Story Desk");
        return;
      }
      req.storyDeskClient = { ...client, authSubject: identity.subject, oauthClientId: identity.oauthClientId };
      req.storyDeskIdentity = identity;
      next();
    } catch {
      res.status(503).json({ error: "authentication_unavailable" });
    }
  };
}
