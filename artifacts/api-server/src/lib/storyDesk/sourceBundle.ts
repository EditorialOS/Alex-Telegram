import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StoryDeskError } from "./errors.js";

interface ManifestFile {
  path: string;
  sha256: string;
}

interface SourceManifest {
  os_version: string;
  files: ManifestFile[];
}

interface ContractManifest {
  contract_version: string;
  source_os_version: string;
  files: ManifestFile[];
}

export interface VerifiedSkills {
  osVersion: string;
  contractVersion: string;
  orchestrator: string;
  storyCommissioner: string;
  contentStrategist: string;
  editorialGate: string;
  editorialVoice: string;
  storyDeskGateContract: string;
}

const REQUIRED_SOURCE_PATHS = [
  "Alex-Final.md",
  "skills/story-commissioner.md",
  "skills/content-strategist.md",
  "skills/editorial-gate.md",
  "skills/editorial-voice.md",
] as const;

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(filename: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as T;
  } catch (error) {
    throw new StoryDeskError("source_integrity_failed", "Could not read a source manifest.", 500, {
      filename,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function verifyFiles(root: string, files: ManifestFile[]): Promise<void> {
  const failures: string[] = [];
  for (const entry of files) {
    const resolved = path.resolve(root, entry.path);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
      failures.push(entry.path);
      continue;
    }
    try {
      const bytes = await readFile(resolved);
      if (digest(bytes) !== entry.sha256) failures.push(entry.path);
    } catch {
      failures.push(entry.path);
    }
  }
  if (failures.length > 0) {
    throw new StoryDeskError("source_integrity_failed", "Alex source integrity verification failed.", 500, {
      files: failures,
    });
  }
}

export class VerifiedSkillLoader {
  private cached?: VerifiedSkills;
  private readonly sourceRoot?: string;
  private readonly contractRoot: string;

  constructor(
    sourceRoot = process.env.ALEX_SOURCE_ROOT,
    contractRoot = process.env.STORY_DESK_CONTRACT_ROOT ??
      path.resolve(process.cwd(), "story-desk/contracts"),
  ) {
    this.sourceRoot = sourceRoot;
    this.contractRoot = contractRoot;
  }

  async load(): Promise<VerifiedSkills> {
    if (this.cached) return this.cached;
    if (!this.sourceRoot) {
      throw new StoryDeskError(
        "source_integrity_failed",
        "ALEX_SOURCE_ROOT must point to the unpacked, verified minimal-os directory.",
        500,
      );
    }

    const sourceManifest = await readJson<SourceManifest>(path.join(this.sourceRoot, "MANIFEST.json"));
    const listed = new Set(sourceManifest.files.map((entry) => entry.path));
    const missingEntries = REQUIRED_SOURCE_PATHS.filter((entry) => !listed.has(entry));
    if (missingEntries.length > 0) {
      throw new StoryDeskError("source_integrity_failed", "The source manifest omits required Alex files.", 500, {
        files: missingEntries,
      });
    }
    await verifyFiles(this.sourceRoot, sourceManifest.files);

    const contractManifest = await readJson<ContractManifest>(path.join(this.contractRoot, "MANIFEST.json"));
    if (contractManifest.source_os_version !== sourceManifest.os_version) {
      throw new StoryDeskError("source_integrity_failed", "Story Desk contract targets a different Alex OS version.", 500, {
        expected: contractManifest.source_os_version,
        actual: sourceManifest.os_version,
      });
    }
    await verifyFiles(this.contractRoot, contractManifest.files);

    const readSource = (relative: string) => readFile(path.join(this.sourceRoot!, relative), "utf8");
    const [orchestrator, storyCommissioner, contentStrategist, editorialGate, editorialVoice,
      storyDeskGateContract] = await Promise.all([
      readSource("Alex-Final.md"),
      readSource("skills/story-commissioner.md"),
      readSource("skills/content-strategist.md"),
      readSource("skills/editorial-gate.md"),
      readSource("skills/editorial-voice.md"),
      readFile(path.join(this.contractRoot, "editorial-gate-story-desk-v1.md"), "utf8"),
    ]);

    this.cached = {
      osVersion: sourceManifest.os_version,
      contractVersion: contractManifest.contract_version,
      orchestrator,
      storyCommissioner,
      contentStrategist,
      editorialGate,
      editorialVoice,
      storyDeskGateContract,
    };
    return this.cached;
  }
}
