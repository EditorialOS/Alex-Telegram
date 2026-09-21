import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StoryDeskError } from "../src/lib/storyDesk/errors.ts";
import { VerifiedSkillLoader } from "../src/lib/storyDesk/sourceBundle.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const sourceRoot = path.join(repositoryRoot, "sources/minimal-os/2.1.0");
const contractRoot = path.join(repositoryRoot, "story-desk/contracts");

test("verified loader composes the Minimal OS 2.1 protocol and Alex instance without a monolith", async () => {
  const loaded = await new VerifiedSkillLoader(sourceRoot, contractRoot).load();

  assert.equal(loaded.osVersion, "2.1.0");
  assert.equal(loaded.contractVersion, "1.0.0");
  assert.match(loaded.orchestratorProtocol, /# Orchestrator Protocol v1\.0/);
  assert.match(loaded.alexInstance, /# Alex — Content Agency Account Director/);
  assert.match(loaded.alexInstance, /supersedes: Alex-Final\.md v2\.1\.0/);
  assert.match(loaded.storyCommissioner, /name: story-commissioner/);
  assert.match(loaded.contentStrategist, /name: content-strategist/);
  assert.match(loaded.editorialGate, /name: editorial-gate/);
  assert.match(loaded.editorialVoice, /name: editorial-voice/);
  assert.equal(
    loaded.provenance.sourceManifestSha256,
    "0f1247bb1fd1905ad0aaecc089a468e32310313b66683cb54e78ab2c3fecdf13",
  );
  assert.deepEqual(
    Object.values(loaded.provenance.files).map(
      (entry) => `${entry.path}@${entry.version}`,
    ),
    [
      "orchestrator-protocol.md@1.0.0",
      "alex.md@3.0.0",
      "skills/story-commissioner.md@1.1.0",
      "skills/content-strategist.md@1.1.0",
      "skills/editorial-gate.md@1.1.0",
      "skills/editorial-voice.md@1.1.0",
      "editorial-gate-story-desk-v1.md@1.0.0",
    ],
  );
});

test("verified loader halts when any manifest-listed source drifts", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "alex-source-drift-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(sourceRoot, temporaryRoot, { recursive: true });
  await appendFile(path.join(temporaryRoot, "alex.md"), "\nDRIFT\n", "utf8");

  await assert.rejects(
    new VerifiedSkillLoader(temporaryRoot, contractRoot).load(),
    (error: unknown) => {
      assert.ok(error instanceof StoryDeskError);
      assert.equal(error.code, "source_integrity_failed");
      assert.deepEqual(error.details?.files, ["alex.md"]);
      return true;
    },
  );
});
