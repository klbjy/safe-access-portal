import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputArg = process.argv[2];
if (!outputArg) throw new Error("Usage: pnpm package:local -- <new-output-directory>");
const output = path.resolve(root, outputArg);
const outputRelative = path.relative(root, output);
if (outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
  throw new Error("Artifact output must stay inside the source repository");
}
try {
  await stat(output);
  throw new Error("Artifact output already exists; choose a new directory");
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
}

const sourceDist = path.join(root, "dist");
await stat(path.join(sourceDist, "worker", "index.js"));
await stat(path.join(sourceDist, "client", "index.html"));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
await cp(path.join(sourceDist, "client"), path.join(output, "dist", "client"), { recursive: true });
await cp(path.join(sourceDist, "worker"), path.join(output, "dist", "worker"), {
  recursive: true,
  filter: (source) => path.basename(source) !== ".dev.vars",
});
await cp(path.join(root, "migrations"), path.join(output, "migrations"), { recursive: true });

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

const payloadFiles = await filesUnder(output);
const prohibitedNames = new Set([".dev.vars", ".env", ".env.local"]);
for (const file of payloadFiles) {
  if (prohibitedNames.has(path.basename(file.relative)) || /\.(sqlite|sqlite3|db)$/iu.test(file.relative)) {
    throw new Error(`Prohibited local file entered the artifact: ${file.relative}`);
  }
}

const localSecretValues = [];
try {
  const localVars = await readFile(path.join(root, ".dev.vars"), "utf8");
  for (const line of localVars.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*['"]?(.*?)['"]?\s*$/u);
    if (!match || match[1] === "APP_ENV") continue;
    const value = match[2];
    if (value && !value.startsWith("<") && value.length >= 4) localSecretValues.push(value);
  }
} catch {
  // Packaging does not require local secrets; absence is the safest state.
}

const manifestFiles = [];
let totalBytes = 0;
for (const file of payloadFiles) {
  const bytes = await readFile(file.fullPath);
  totalBytes += bytes.byteLength;
  for (const secret of localSecretValues) {
    if (bytes.includes(Buffer.from(secret))) throw new Error(`A local secret value entered artifact payload: ${file.relative}`);
  }
  manifestFiles.push({ path: file.relative, bytes: bytes.byteLength, sha256: sha256(bytes) });
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
  artifactType: "cloudflare-worker-directory",
  payloadDigest: `sha256:${payloadDigest}`,
  payloadBytes: totalBytes,
  entrypoint: "dist/worker/index.js",
  deployConfig: "dist/worker/wrangler.json",
  healthPath: "/api/health",
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
  builder: { node: process.version, platform: process.platform, architecture: process.arch, packageManager: packageJson.packageManager },
  commands: ["pnpm install --frozen-lockfile", "pnpm run typecheck", "pnpm run test", "pnpm run build", "pnpm package:local"],
  target: { runtime: "cloudflare-workers", architecture: "isolate", os: "provider-managed", port: null },
  requiredBindings: ["DB"],
  requiredSecrets: ["DATA_KEY", "BOOTSTRAP_ADMIN_NAME", "BOOTSTRAP_ADMIN_STUDENT_ID", "BOOTSTRAP_VAULT_PASSWORD"],
  remoteActionsPerformed: false,
};

await writeFile(path.join(output, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, "SBOM.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
await writeFile(path.join(output, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ payloadDigest: manifest.payloadDigest, payloadBytes: totalBytes, files: manifestFiles.length })}\n`);
