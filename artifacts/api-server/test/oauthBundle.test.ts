import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(apiRoot, "../..");

test("the committed OAuth browser asset matches its TypeScript source", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "alex-oauth-bundle-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const generated = path.join(temporaryRoot, "oauth.js");

  await build({
    entryPoints: [path.join(apiRoot, "src/browser/oauth.ts")],
    platform: "browser",
    bundle: true,
    format: "esm",
    outfile: generated,
    logLevel: "silent",
    minify: true,
  });

  const [expected, actual] = await Promise.all([
    readFile(generated),
    readFile(path.join(repositoryRoot, "public/story-desk/oauth.js")),
  ]);
  assert.deepEqual(actual, expected);
});
