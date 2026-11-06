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
const lines = path => readFileSync(path, "utf8").split("\n");
let count = 0, anchored = 0;
for (const file of walk(process.cwd())) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const [target, anchor = ""] = match[1].split("#");
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const path = resolve(dirname(file), decodeURIComponent(target));
    assert(existsSync(path), `${file}: broken link ${target}`);
    const line = /^L(\d+)(?:-L\d+)?$/.exec(anchor);
    assert(!line || lines(path)[Number(line[1]) - 1] !== undefined, `${file}: ${target} has no line ${line?.[1]}`);
    count++;
  }
  // A link to a line names what is there. When its text is code, the line must still hold the
  // text's last segment as a whole word (`Verifier::verify` -> `verify`), so a line that moved
  // fails here instead of silently pointing at other code.
  for (const match of source.matchAll(/\[`([^`\]]+)`\]\(([^)#]+)#L(\d+)(?:-L\d+)?\)/g)) {
    if (/^[a-z]+:/i.test(match[2])) continue;
    const name = match[1].split(/::|\./).filter(Boolean).at(-1);
    const text = lines(resolve(dirname(file), decodeURIComponent(match[2])))[Number(match[3]) - 1];
    const word = new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`);
    assert(word.test(text), `${file}: ${match[2]}#L${match[3]} no longer holds ${name}: ${text.trim()}`);
    anchored++;
  }
}
console.log(`${count} local Markdown links resolve; ${anchored} line links still hold the code they name.`);
