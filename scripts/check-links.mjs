import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { strict as assert } from "node:assert";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", "dist", ".git", ".worktrees"].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}
let count = 0;
for (const file of walk(process.cwd())) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert(existsSync(resolve(dirname(file), decodeURIComponent(target))), `${file}: broken link ${target}`);
    count++;
  }
}
console.log(`${count} local Markdown links resolve.`);
