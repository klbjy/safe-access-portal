import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputArg = process.argv[2];
if (!outputArg) throw new Error("Usage: pnpm package:local -- <new-output-directory>");

const output = path.resolve(root, outputArg);
const outputRelative = path.relative(root, output);
if (!outputRelative || outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
  throw new Error("Artifact output must be a new directory inside the source repository");
}
try {
  await stat(output);
  throw new Error("Artifact output already exists; choose a new directory");
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
}

const sourceDist = path.join(root, "dist");
await stat(path.join(sourceDist, "index.html"));
await stat(path.join(sourceDist, "site-config.json"));

async function filesUnder(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const fullPath = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(fullPath, relative));
    else if (entry.isFile()) files.push({ fullPath, relative });
  }
  return files;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const sourceFiles = await filesUnder(sourceDist);
const prohibitedNames = new Set([".dev.vars", ".env", ".env.local"]);
for (const file of sourceFiles) {
  const basename = path.basename(file.relative);
  if (
    prohibitedNames.has(basename)
    || /\.(sqlite|sqlite3|db|xlsx|xls|csv|pem|key|log|map)$/iu.test(file.relative)
  ) {
    throw new Error(`Prohibited file entered the Pages artifact: ${file.relative}`);
  }
}

const siteDirectory = path.join(output, "site");
await mkdir(output, { recursive: false });
await cp(sourceDist, siteDirectory, { recursive: true });

const manifestFiles = [];
let totalBytes = 0;
for (const file of sourceFiles) {
  const bytes = await readFile(file.fullPath);
  totalBytes += bytes.byteLength;
  manifestFiles.push({ path: path.posix.join("site", file.relative), bytes: bytes.byteLength, sha256: sha256(bytes) });
}

const manifestIdentity = manifestFiles.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join("");
const payloadDigest = sha256(manifestIdentity);
const lockfileDigest = sha256(await readFile(path.join(root, "pnpm-lock.yaml")));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const components = Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => ({
  type: "library",
  name,
  version,
  purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
}));

const manifest = {
  schemaVersion: 1,
  name: packageJson.name,
  version: packageJson.version,
  artifactType: "github-pages-static-directory",
  payloadDigest: `sha256:${payloadDigest}`,
  payloadBytes: totalBytes,
  entrypoint: "site/index.html",
  configuration: "site/site-config.json",
  files: manifestFiles,
};
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: { component: { type: "application", name: packageJson.name, version: packageJson.version } },
  components: components.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en")),
};
const provenance = {
  generatedAt: new Date().toISOString(),
  sourceIdentity: `sha256:${lockfileDigest}`,
  sourceIdentityKind: "pnpm-lockfile",
  builder: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    packageManager: packageJson.packageManager,
  },
  commands: [
    "pnpm install --frozen-lockfile",
    "pnpm run typecheck",
    "pnpm run test",
    "pnpm audit --prod --audit-level=high",
    "VITE_BASE_PATH=/safe-access-portal/ pnpm run build",
    "pnpm package:local",
  ],
  target: { runtime: "github-pages", architecture: "static", os: "browser", port: null },
  requiredBindings: [],
  requiredSecrets: [],
  remoteActionsPerformed: false,
};

await writeFile(path.join(output, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, "SBOM.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
await writeFile(path.join(output, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ payloadDigest: manifest.payloadDigest, payloadBytes: totalBytes, files: manifestFiles.length })}\n`);
