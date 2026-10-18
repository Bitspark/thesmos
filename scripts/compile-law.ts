import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { clauseValue, ClauseId, MapProgram, programBytes } from "@bitspark/logos-contract";
import { loadSearcher, parseVerdict } from "@bitspark/logos-kernel";

const require = createRequire(import.meta.url);
const parser = await loadSearcher();
for (const name of ["common-law", "assertion-template", "layers/space-asserter-template"]) {
  const sourceUrl = require.resolve(`@bitspark/thesmos/law/${name}.logos`);
  const outputUrl = sourceUrl.replace(/\.logos$/, ".ontos");
  const source = readFileSync(sourceUrl, "utf8").replace(/\r\n/g, "\n");
  const parsed = parser.parseProgram(source);
  if (parseVerdict(parsed).kind !== "parsed" || parsed.directives.length) {
    throw new Error("Common law did not parse completely: " + JSON.stringify(parsed.diagnostics));
  }
  const parts = source.split(/^% @id ([a-z][a-z-]*)\s*$/m);
  const program = new MapProgram();
  let ordinal = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i]!;
    const block = parser.parseProgram(parts[i + 1]!);
    if (parseVerdict(block).kind !== "parsed" || block.clauses.length !== 1 || block.directives.length) {
      throw new Error("Each @id must name exactly one Logos clause: " + name);
    }
    const clause = block.clauses[0]!;
    if (program.clause(ClauseId.of(name))) throw new Error("Duplicate clause id: " + name);
    // Full-source parsing also catches unlabelled clauses and annotation mistakes.
    const fullClause = parsed.clauses[ordinal++];
    if (!fullClause || !clauseValue(clause).equals(clauseValue(fullClause))) throw new Error("Unlabelled or misplaced law clause");
    program.insert(ClauseId.of(name), clause);
  }
  if (ordinal !== parsed.clauses.length) throw new Error("Every law clause needs an @id");
  const bytes = programBytes(program);
  if (process.argv.includes("--check")) {
    if (!readFileSync(outputUrl).equals(bytes)) {
      throw new Error("Compiled law is stale; run npm run law:compile");
    }
    console.log(`${name} is current (${ordinal} clauses).`);
  } else {
    writeFileSync(outputUrl, bytes);
    console.log(`Compiled ${name} (${ordinal} clauses).`);
  }
}
