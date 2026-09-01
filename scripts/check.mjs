import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
if (manifest.host_permissions?.includes("<all_urls>")) errors.push("<all_urls> is not allowed");

const requiredFiles = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((item) => item.js || []),
  ...Object.values(manifest.icons || {})
].filter(Boolean);

for (const file of requiredFiles) {
  try {
    const info = await stat(join(dist, file));
    if (!info.isFile() || info.size === 0) errors.push(`${file} is empty`);
  } catch {
    errors.push(`${file} is missing`);
  }
}

const files = await readdir(dist, { recursive: true });
for (const file of files.filter((name) => name.endsWith(".js"))) {
  const content = await readFile(join(dist, file), "utf8");
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(content)) errors.push(`${file} contains dynamic code execution`);
  const urls = content.match(/https?:\/\/[^\s"'`<>)]+/g) || [];
  for (const rawUrl of urls) {
    try {
      const hostname = new URL(rawUrl.replace(/\\+$/g, "")).hostname.toLowerCase();
      const isDocumentation = ["w3.org", "aomedia.org", "github.com", "github.io"].some(
        (root) => hostname === root || hostname.endsWith(`.${root}`)
      );
      if (!isDocumentation && !hostname.includes("amazon")) {
        errors.push(`${file} contains an unexpected remote endpoint: ${hostname}`);
      }
    } catch {
      // Ignore non-URL library template strings.
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validation passed: ${requiredFiles.length} declared files present; no broad host permission or dynamic execution.`);
}
