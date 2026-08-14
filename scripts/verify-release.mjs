import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : process.env.RELEASE_TAG;

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(rootDirectory, relativePath), "utf8"));
}

function packageFiles() {
  const files = ["package.json", "desktop-app/package.json", "adapters/feishu/package.json", "feishu-bot/package.json"];
  for (const directory of readdirSync(join(rootDirectory, "packages"), { withFileTypes: true })) {
    if (directory.isDirectory()) files.push(join("packages", directory.name, "package.json"));
  }
  return files.sort();
}

const rootPackage = readJson("package.json");
const version = rootPackage.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Root package version must be stable semver");
if (!tag) throw new Error("Release tag is required via --tag or RELEASE_TAG");
if (tag !== "v" + version) throw new Error("Release tag " + tag + " does not match package version v" + version);

const files = packageFiles();
const packages = files.map((file) => ({ file, manifest: readJson(file) }));
for (const item of packages) {
  if (item.manifest.version !== version) {
    throw new Error(item.file + " version " + item.manifest.version + " does not match " + version);
  }
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, dependencyVersion] of Object.entries(item.manifest[section] || {})) {
      if (name.startsWith("@paopao/") && dependencyVersion !== version) {
        throw new Error(item.file + " pins " + name + " to " + dependencyVersion + ", expected " + version);
      }
    }
  }
}

const lock = readJson("package-lock.json");
if (lock.version !== version || lock.packages?.[""]?.version !== version) {
  throw new Error("package-lock.json root version does not match " + version);
}
for (const item of packages) {
  if (item.file === "feishu-bot/package.json") continue;
  const key = item.file === "package.json" ? "" : dirname(item.file);
  if (lock.packages?.[key]?.version !== version) {
    throw new Error("package-lock.json entry " + (key || "<root>") + " does not match " + version);
  }
}

const releaseNotes = join(rootDirectory, "docs", "releases", tag + ".md");
if (!existsSync(releaseNotes)) throw new Error("Missing release notes: " + releaseNotes);
if (!existsSync(join(rootDirectory, "CHANGELOG.md"))) throw new Error("Missing CHANGELOG.md");

process.stdout.write(JSON.stringify({ tag, version, packageFiles: files, releaseNotes }, null, 2) + "\n");
