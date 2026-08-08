// Surface-agnostic command parsing.
//
// Slack sends slash commands with hyphens (`/weekly-social`); Telegram command
// names may only use [a-z0-9_], so the same command arrives as `/weekly_social`,
// and in groups it carries a bot suffix (`/weekly_social@AlexBot`). This module
// normalizes all of that to ONE canonical form — lowercased, hyphenated, with a
// leading slash — which is exactly what the registry (registry.ts) is keyed on.
//
// This is the parser both surfaces route through. It ships with a unit test
// (test/commandParser.test.ts) that covers every row of the command table.

export interface ParsedCommand {
  /** True when the input begins with a slash command token. */
  isCommand: boolean;
  /** Canonical command, e.g. "/weekly-social" — lowercased, hyphenated, slash-prefixed. Undefined when not a command. */
  command?: string;
  /** Everything after the command token, trimmed. For non-commands, the whole trimmed input. */
  args: string;
  /** The original input, untouched. */
  raw: string;
}

const COMMAND_RE = /^\/([A-Za-z0-9_-]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/;

/** Canonicalize a bare command token (no slash): lowercase, underscores → hyphens. */
export function canonicalizeCommand(token: string): string {
  return `/${token.toLowerCase().replace(/_/g, "-")}`;
}

/**
 * Parse a raw message into a command + args, or a plain-text message.
 *
 * @param input        The raw message text.
 * @param botUsername  Optional. When provided, a `@name` suffix is only honored
 *                     if it matches this bot (case-insensitive); a mention of a
 *                     different bot is treated as plain text, not our command.
 */
export function parseCommand(input: string, botUsername?: string): ParsedCommand {
  const raw = input ?? "";
  const trimmed = raw.trim();

  if (!trimmed.startsWith("/")) {
    return { isCommand: false, args: trimmed, raw };
  }

  const match = trimmed.match(COMMAND_RE);
  if (!match) {
    return { isCommand: false, args: trimmed, raw };
  }

  const [, token, atName, rest] = match;

  // In a group, `/brief@OtherBot` is not addressed to us.
  if (atName && botUsername && atName.toLowerCase() !== botUsername.toLowerCase()) {
    return { isCommand: false, args: trimmed, raw };
  }

  return {
    isCommand: true,
    command: canonicalizeCommand(token),
    args: (rest ?? "").trim(),
    raw,
  };
}

/** Render a canonical command as its Telegram form (hyphens → underscores, no slash). */
export function toTelegramCommandName(canonical: string): string {
  return canonical.replace(/^\//, "").replace(/-/g, "_");
}
