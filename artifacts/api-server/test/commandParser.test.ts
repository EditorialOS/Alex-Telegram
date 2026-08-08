import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCommand,
  canonicalizeCommand,
  toTelegramCommandName,
} from "../src/lib/alex/commandParser.ts";

// Every row of the §3.1 command table. Left = how Telegram delivers it
// (underscores, optional @bot suffix); right = the canonical registry command.
const TABLE: Array<[string, string]> = [
  ["/brief", "/brief"],
  ["/weekly_social", "/weekly-social"],
  ["/morning_briefing", "/morning-briefing"],
  ["/caption", "/caption"],
  ["/hook", "/hook"],
  ["/headline", "/headline"],
  ["/subject_line", "/subject-line"],
  ["/reply", "/reply"],
  ["/outline", "/outline"],
  ["/alex_update", "/alex-update"],
  ["/start", "/start"],
  ["/help", "/help"],
];

test("every command normalizes to its canonical registry form", () => {
  for (const [telegram, canonical] of TABLE) {
    assert.equal(parseCommand(telegram).command, canonical, `bare: ${telegram}`);
    // Slack's own hyphenated form must also map to the same canonical command.
    assert.equal(parseCommand(canonical).command, canonical, `slack: ${canonical}`);
  }
});

test("uppercase and mixed case are normalized", () => {
  assert.equal(parseCommand("/Weekly_Social").command, "/weekly-social");
  assert.equal(parseCommand("/BRIEF launch the thing").command, "/brief");
});

test("group @bot suffix is stripped", () => {
  const p = parseCommand("/weekly_social@AlexBot make it punchy");
  assert.equal(p.command, "/weekly-social");
  assert.equal(p.args, "make it punchy");
});

test("@bot suffix for a different bot is not treated as our command", () => {
  const p = parseCommand("/brief@SomeOtherBot idea", "AlexBot");
  assert.equal(p.isCommand, false);
});

test("@bot suffix matching our username is our command", () => {
  const p = parseCommand("/brief@alexbot idea here", "AlexBot");
  assert.equal(p.isCommand, true);
  assert.equal(p.command, "/brief");
  assert.equal(p.args, "idea here");
});

test("args are extracted verbatim and trimmed, body preserved", () => {
  const p = parseCommand("/brief   a rooftop brunch\nwith two angles  ");
  assert.equal(p.command, "/brief");
  assert.equal(p.args, "a rooftop brunch\nwith two angles");
});

test("plain text is not a command", () => {
  const p = parseCommand("what's happening this week?");
  assert.equal(p.isCommand, false);
  assert.equal(p.command, undefined);
  assert.equal(p.args, "what's happening this week?");
});

test("a lone slash / gibberish slash token is still parsed as command token or text", () => {
  assert.equal(parseCommand("/").isCommand, false);
  assert.equal(parseCommand("/ hello").isCommand, false);
});

test("canonicalizeCommand and toTelegramCommandName round-trip", () => {
  assert.equal(canonicalizeCommand("weekly_social"), "/weekly-social");
  assert.equal(toTelegramCommandName("/weekly-social"), "weekly_social");
  assert.equal(toTelegramCommandName("/brief"), "brief");
});
