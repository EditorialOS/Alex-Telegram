# Getting Alex to 100% — Setup Guide

When Alex first joins your Slack, it runs in **neutral mode**. That's the red note you
saw: *"Brand context isn't configured, so I wrote this in a neutral voice."* Alex still
works, but it sounds like a generic writer, not like *you*.

This guide walks you through the handful of commands that load your brand into Alex so it
writes in **full force** — your voice, your audience, your topics — and so the quality
**Gate** judges work against *your* standard instead of a neutral one.

It takes about 15 minutes. You only do it once per workspace.

---

## How it works (10-second version)

- You teach Alex about your brand by running `/alex-update [topic] [your info]` commands.
- Each one saves a "brand file" that Alex reads before writing anything.
- The more you fill in, the more Alex sounds like your team. **Brand voice is the big
  one** — it's what flips Alex from neutral to full force and what the Gate scores against.

> **Note:** Only a **workspace admin** can run `/alex-update`. If you get a "⛔ Only
> workspace admins can update Alex's brand files" message, ask an admin to run these, or
> have your Slack admin make you an admin.

You can paste these straight into any Slack channel where Alex lives. Replace the example
text with your own.

---

## Step 1 — Brand voice ⭐ (the most important one)

This is what stops the neutral warning and unlocks full-force Alex. Describe how your
brand sounds: tone, personality, what you do and don't say.

```
/alex-update brand-voice We are a sharp, optimistic editorial brand covering the future of media. Tone: confident, plainspoken, a little irreverent — never corporate or hype-y. We write like a smart friend who's done the reading. We favor short punchy sentences, concrete examples over abstractions, and we never use buzzwords like "synergy," "leverage," or "game-changer." We're skeptical of hype but genuinely excited about real progress. American English. Oxford comma.
```

**Tip:** be specific about *banned words* and *sentence style* — that's what makes the
difference between "fine" and "sounds exactly like us."

---

## Step 2 — Audience personas (who you're writing for)

Tell Alex who's on the other end. This shapes vocabulary, examples, and what Alex assumes
the reader already knows.

```
/alex-update audience-personas Primary: media and marketing professionals aged 28–45 who follow industry trends closely and are short on time. They're smart, busy, and allergic to fluff. Secondary: founders and creators building media brands. They want practical insight they can act on today, not theory. Assume they know the basics of the industry — don't over-explain.
```

---

## Step 3 — Content pillars (what you write about)

The core topics your brand owns. Alex uses these to keep everything on-brand and to know
what angles matter to you.

```
/alex-update content-pillars 1) The future of journalism and AI in newsrooms. 2) Media business models — subscriptions, ads, creator economy. 3) Audience growth and engagement tactics. 4) Tools and workflows for modern media teams. Every piece should ladder up to one of these.
```

---

## Step 4 — Style guide (formatting & rules)

Your nuts-and-bolts formatting rules: how you handle headlines, hashtags, emoji, links,
length, capitalization, etc.

```
/alex-update style-guide Headlines: sentence case, no clickbait, under 70 characters. Social captions: 1–3 short paragraphs, max 2 emoji, 3–5 relevant hashtags at the end. Never use ALL CAPS for emphasis. Use "—" em dashes, not hyphens. Spell out numbers under 10. Always end social posts with a clear call to action or a question.
```

---

## Step 5 (optional) — Competitive landscape

Who you're up against and how you're different. Helps Alex position your content and spot
angles competitors miss.

```
/alex-update competitive-landscape Main competitors: [Competitor A] (strong on breaking news, weak on analysis), [Competitor B] (great newsletters, thin on social). Our edge: sharper opinions, faster takes, and a more human voice. We win on insight and personality, not on being first.
```

---

## Step 6 (optional) — Standing orders

Recurring campaigns or rules Alex should always keep in mind — like an active product
launch, a weekly series, or a current theme.

```
/alex-update standing-orders We're running a "Future of Newsrooms" series every Tuesday through August — tie relevant content to it when it fits. Currently promoting our upcoming industry report (link drops July 1). Always nudge readers toward the newsletter signup.
```

---

## Step 7 (optional) — Name & persona

By default the bot is named **Alex**. If you want a different name or a specific
personality, set it here. Put the name on the first line as `Name: ...`.

```
/alex-update teammate Name: Jordan
You're our senior editor — warm but exacting, with 15 years in digital media. You push for clarity and never let a weak headline slide. You explain your edits so the team learns.
```

---

## Step 8 (optional) — Google Drive folder

If you want Alex's approved routine output to auto-file into a specific Google Drive
folder, paste the folder's ID here. (The ID is the long string at the end of the folder's
URL in your browser.)

```
/alex-update drive-folder 1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv
```

---

## Step 9 — Check that it worked

Run a real command and look at the result:

```
/brief Write a LinkedIn post about why most newsrooms are adopting AI too slowly
```

You'll know Alex is at full force when:

- ✅ **No more red "Brand context isn't configured" note.**
- ✅ The writing sounds like *your* voice from Step 1 (your tone, your banned words gone).
- ✅ The **Gate score climbs** — it's now judging against your standard, not a neutral one.

If you still see the neutral note, double-check that **Step 1 (brand-voice)** actually
saved — re-run it. That single field is what flips the switch.

---

## Quick reference — all the commands

| Step | Command | What it does | Required? |
|------|---------|--------------|-----------|
| 1 | `/alex-update brand-voice …` | Your tone & personality | ⭐ **Yes** |
| 2 | `/alex-update audience-personas …` | Who you write for | Strongly recommended |
| 3 | `/alex-update content-pillars …` | Your core topics | Strongly recommended |
| 4 | `/alex-update style-guide …` | Formatting rules | Recommended |
| 5 | `/alex-update competitive-landscape …` | Competitors & positioning | Optional |
| 6 | `/alex-update standing-orders …` | Active campaigns/rules | Optional |
| 7 | `/alex-update teammate …` | Custom name & persona | Optional |
| 8 | `/alex-update drive-folder …` | Auto-file output to Drive | Optional |

**Minimum for full force:** Steps 1–3. **For best results:** do Steps 1–4.

You can update any of these any time — just run the command again with new text and it
overwrites the old one.
