import { cp, mkdir, rm } from "node:fs/promises";

const rootFiles = ["index.html", "favicon.svg"];
const dirs = ["src", "data", "vendor"];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of rootFiles) {
  await cp(file, `dist/${file}`);
}

for (const dir of dirs) {
  await cp(dir, `dist/${dir}`, { recursive: true });
}

console.log("Built WikiPulse into dist/");
