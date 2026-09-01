import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "icons"), { recursive: true });

await build({
  entryPoints: [join(root, "src/popup.js")],
  outfile: join(dist, "popup.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome102",
  minify: false,
  legalComments: "eof"
});

for (const [source, destination] of [
  ["manifest.json", "manifest.json"],
  ["popup.html", "popup.html"],
  ["popup.css", "popup.css"],
  ["src/background.js", "background.js"],
  ["src/content.js", "content.js"]
]) {
  await cp(join(root, source), join(dist, destination));
}

for (const size of [16, 32, 48, 128]) {
  const generated = join(root, "assets", `icon-${size}.png`);
  await cp(generated, join(dist, "icons", `icon-${size}.png`));
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built unpacked extension: ${dist}`);
