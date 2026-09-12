#!/usr/bin/env node
// Runs the eval set against the real classifier (real API calls, no mocking)
// and reports pass/fail per case, including the calibration controls --
// per this project's own standing rule, a run without controls proves
// nothing, and a run where the controls fail is a NULL result, not just a
// lower score.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadPatterns, classifyReport, resolveApiKey } from "../src/triage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const apiKey = resolveApiKey();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not found in the environment or .env -- see README.");
  process.exit(2);
}

const casesFile = process.argv[2] || "cases.json";
const patternSet = loadPatterns(join(__dirname, "..", "patterns", "curl.json"));
const cases = JSON.parse(readFileSync(join(__dirname, casesFile), "utf8"));
console.log(`Eval set: ${casesFile} (${cases.length} cases)\n`);

let passed = 0;
let controlFailures = 0;
const results = [];

let harnessErrors = 0;

for (const c of cases) {
  process.stdout.write(`Running ${c.id} (${c.kind})... `);
  let verdict;
  try {
    verdict = await classifyReport(patternSet, c.report, { apiKey });
  } catch (err) {
    harnessErrors++;
    console.log(`HARNESS ERROR -- ${err.message}`);
    results.push({ case: c.id, kind: c.kind, expected: c.expected_verdict, actual: "harness-error", ok: false });
    continue;
  }
  const ok = verdict.verdict === c.expected_verdict;
  const truncatedNote = verdict.truncated ? " [truncated response]" : "";
  if (ok) {
    passed++;
    console.log(`PASS (${verdict.verdict})${truncatedNote}`);
  } else {
    if (c.kind === "calibration_control") controlFailures++;
    console.log(`FAIL -- expected ${c.expected_verdict}, got ${verdict.verdict}${truncatedNote}`);
    console.log(`  reasoning: ${verdict.reasoning}`);
  }
  results.push({ case: c.id, kind: c.kind, expected: c.expected_verdict, actual: verdict.verdict, ok });
}

if (harnessErrors > 0) {
  console.log(`\n${harnessErrors} case(s) hit a harness error (not a model verdict) -- see above, these need investigating separately from the pass/fail score.`);
}

console.log(`\n${passed}/${cases.length} cases passed.`);

if (controlFailures > 0) {
  console.log(
    `\nNULL RESULT: ${controlFailures} calibration control(s) failed. A control failure means the ` +
    `run has not established what it needs to establish (the tool correctly avoids false-rejects) -- ` +
    `this is not a partial pass, the mechanism is not proven regardless of the junk-case score above.`,
  );
  process.exitCode = 1;
} else {
  const controlsRun = cases.filter((c) => c.kind === "calibration_control").length;
  console.log(`\nAll ${controlsRun} calibration controls held -- no false-rejects on this eval set.`);
}
