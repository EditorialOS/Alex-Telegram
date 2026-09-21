import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { StoryDeskError } from "./errors.js";

interface ManifestFile {
  path: string;
  version?: string;
  sha256: string;
}

interface SourceManifest {
  os_version: string;
  files: ManifestFile[];
}

interface ContractManifest {
  contract_version: string;
  source_os_version: string;
  source_editorial_gate_version?: string;
  files: ManifestFile[];
}

export interface VerifiedSourceReference {
  path: string;
  version: string;
  sha256: string;
}

export interface VerifiedSourceProvenance {
  osVersion: string;
  sourceManifestSha256: string;
  contractVersion: string;
  contractManifestSha256: string;
  files: {
    orchestratorProtocol: VerifiedSourceReference;
    alexInstance: VerifiedSourceReference;
    storyCommissioner: VerifiedSourceReference;
    contentStrategist: VerifiedSourceReference;
    editorialGate: VerifiedSourceReference;
    editorialVoice: VerifiedSourceReference;
    storyDeskGateContract: VerifiedSourceReference;
  };
}

export interface VerifiedSkills {
  osVersion: string;
  contractVersion: string;
  orchestratorProtocol: string;
  alexInstance: string;
  storyCommissioner: string;
  contentStrategist: string;
  editorialGate: string;
  editorialVoice: string;
  storyDeskGateContract: string;
  provenance: VerifiedSourceProvenance;
}

const SOURCE_OS_VERSION = "2.1.0";
const REQUIRED_SOURCE_FILES = {
  orchestratorProtocol: { path: "orchestrator-protocol.md", version: "1.0.0" },
  alexInstance: { path: "alex.md", version: "3.0.0" },
  storyCommissioner: { path: "skills/story-commissioner.md", version: "1.1.0" },
  contentStrategist: { path: "skills/content-strategist.md", version: "1.1.0" },
  editorialGate: { path: "skills/editorial-gate.md", version: "1.1.0" },
  editorialVoice: { path: "skills/editorial-voice.md", version: "1.1.0" },
} as const;

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson<T>(bytes: Buffer, filename: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    throw new StoryDeskError(
      "source_integrity_failed",
      "Could not read a source manifest.",
      500,
      {
        filename,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function readManifest<T>(
  filename: string,
): Promise<{ bytes: Buffer; value: T }> {
  try {
    const bytes = await readFile(filename);
    return { bytes, value: parseJson<T>(bytes, filename) };
  } catch (error) {
    if (error instanceof StoryDeskError) throw error;
    throw new StoryDeskError(
      "source_integrity_failed",
      "Could not read a source manifest.",
      500,
      {
        filename,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function verifyFiles(root: string, files: ManifestFile[]): Promise<void> {
  const failures: string[] = [];
  const resolvedRoot = path.resolve(root);
  const seen = new Set<string>();
  for (const entry of files) {
    if (seen.has(entry.path)) {
      failures.push(entry.path);
      continue;
    }
    seen.add(entry.path);
    const resolved = path.resolve(root, entry.path);
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
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
    throw new StoryDeskError(
      "source_integrity_failed",
      "Alex source integrity verification failed.",
      500,
      {
        files: [...new Set(failures)].sort(),
      },
    );
  }
}

async function hasManifest(root: string): Promise<boolean> {
  try {
    await access(path.join(root, "MANIFEST.json"));
    return true;
  } catch {
    return false;
  }
}

async function resolveRoot(
  explicitRoot: string | undefined,
  candidates: string[],
  environmentVariable: string,
): Promise<string> {
  if (explicitRoot) return path.resolve(explicitRoot);
  for (const candidate of candidates) {
    if (await hasManifest(candidate)) return candidate;
  }
  throw new StoryDeskError(
    "source_integrity_failed",
    `${environmentVariable} must point to a directory containing MANIFEST.json.`,
    500,
    { searched: candidates },
  );
}

function requiredReference(
  entries: Map<string, ManifestFile>,
  requirement: { path: string; version: string },
): VerifiedSourceReference {
  const entry = entries.get(requirement.path);
  if (!entry || entry.version !== requirement.version) {
    throw new StoryDeskError(
      "source_integrity_failed",
      "The source manifest omits or misversions a required Alex file.",
      500,
      {
        file: requirement.path,
        expected_version: requirement.version,
        actual_version: entry?.version,
      },
    );
  }
  return { path: entry.path, version: entry.version, sha256: entry.sha256 };
}

export class VerifiedSkillLoader {
  private cached?: VerifiedSkills;
  private readonly configuredSourceRoot?: string;
  private readonly configuredContractRoot?: string;

  constructor(
    sourceRoot = process.env.ALEX_SOURCE_ROOT,
    contractRoot = process.env.STORY_DESK_CONTRACT_ROOT,
  ) {
    this.configuredSourceRoot = sourceRoot;
    this.configuredContractRoot = contractRoot;
  }

  async load(): Promise<VerifiedSkills> {
    if (this.cached) return this.cached;

    const sourceRoot = await resolveRoot(
      this.configuredSourceRoot,
      [
        path.resolve(process.cwd(), "sources/minimal-os", SOURCE_OS_VERSION),
        path.resolve(
          process.cwd(),
          "../..",
          "sources/minimal-os",
          SOURCE_OS_VERSION,
        ),
      ],
      "ALEX_SOURCE_ROOT",
    );
    const contractRoot = await resolveRoot(
      this.configuredContractRoot,
      [
        path.resolve(process.cwd(), "story-desk/contracts"),
        path.resolve(process.cwd(), "../..", "story-desk/contracts"),
      ],
      "STORY_DESK_CONTRACT_ROOT",
    );

    const sourceManifestPath = path.join(sourceRoot, "MANIFEST.json");
    const sourceManifestResult =
      await readManifest<SourceManifest>(sourceManifestPath);
    const sourceManifest = sourceManifestResult.value;
    if (sourceManifest.os_version !== SOURCE_OS_VERSION) {
      throw new StoryDeskError(
        "source_integrity_failed",
        "The Alex source OS version is not approved.",
        500,
        {
          expected: SOURCE_OS_VERSION,
          actual: sourceManifest.os_version,
        },
      );
    }
    const sourceEntries = new Map(
      sourceManifest.files.map((entry) => [entry.path, entry]),
    );
    const sourceReferences = {
      orchestratorProtocol: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.orchestratorProtocol,
      ),
      alexInstance: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.alexInstance,
      ),
      storyCommissioner: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.storyCommissioner,
      ),
      contentStrategist: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.contentStrategist,
      ),
      editorialGate: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.editorialGate,
      ),
      editorialVoice: requiredReference(
        sourceEntries,
        REQUIRED_SOURCE_FILES.editorialVoice,
      ),
    };
    await verifyFiles(sourceRoot, sourceManifest.files);

    const contractManifestPath = path.join(contractRoot, "MANIFEST.json");
    const contractManifestResult =
      await readManifest<ContractManifest>(contractManifestPath);
    const contractManifest = contractManifestResult.value;
    if (contractManifest.source_os_version !== sourceManifest.os_version) {
      throw new StoryDeskError(
        "source_integrity_failed",
        "Story Desk contract targets a different Alex OS version.",
        500,
        {
          expected: contractManifest.source_os_version,
          actual: sourceManifest.os_version,
        },
      );
    }
    if (
      contractManifest.source_editorial_gate_version !==
      sourceReferences.editorialGate.version
    ) {
      throw new StoryDeskError(
        "source_integrity_failed",
        "Story Desk contract targets a different Editorial Gate version.",
        500,
        {
          expected: contractManifest.source_editorial_gate_version,
          actual: sourceReferences.editorialGate.version,
        },
      );
    }
    await verifyFiles(contractRoot, contractManifest.files);
    const gateContractEntry = contractManifest.files.find(
      (entry) => entry.path === "editorial-gate-story-desk-v1.md",
    );
    if (!gateContractEntry) {
      throw new StoryDeskError(
        "source_integrity_failed",
        "The Story Desk manifest omits its gate contract.",
        500,
      );
    }

    const readSource = (relative: string) =>
      readFile(path.join(sourceRoot, relative), "utf8");
    const [
      orchestratorProtocol,
      alexInstance,
      storyCommissioner,
      contentStrategist,
      editorialGate,
      editorialVoice,
      storyDeskGateContract,
    ] = await Promise.all([
      readSource(sourceReferences.orchestratorProtocol.path),
      readSource(sourceReferences.alexInstance.path),
      readSource(sourceReferences.storyCommissioner.path),
      readSource(sourceReferences.contentStrategist.path),
      readSource(sourceReferences.editorialGate.path),
      readSource(sourceReferences.editorialVoice.path),
      readFile(path.join(contractRoot, gateContractEntry.path), "utf8"),
    ]);

    this.cached = {
      osVersion: sourceManifest.os_version,
      contractVersion: contractManifest.contract_version,
      orchestratorProtocol,
      alexInstance,
      storyCommissioner,
      contentStrategist,
      editorialGate,
      editorialVoice,
      storyDeskGateContract,
      provenance: {
        osVersion: sourceManifest.os_version,
        sourceManifestSha256: digest(sourceManifestResult.bytes),
        contractVersion: contractManifest.contract_version,
        contractManifestSha256: digest(contractManifestResult.bytes),
        files: {
          ...sourceReferences,
          storyDeskGateContract: {
            path: gateContractEntry.path,
            version: contractManifest.contract_version,
            sha256: gateContractEntry.sha256,
          },
        },
      },
    };
    return this.cached;
  }
}
