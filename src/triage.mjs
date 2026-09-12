// Core triage mechanism: classify an incoming vulnerability report against
// a project's own documented defensive patterns.
//
// Design constraint (deliberate, not an afterthought -- see BRIEF.md's
// "Known open items"): a false auto-reject of a real vulnerability is worse
// than doing nothing. The prompt is built to fail toward "needs human
// review" -- "likely-junk" requires the report to describe a scenario a
// named pattern demonstrably already prevents, not just resemble one.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadPatterns(patternsPath) {
  return JSON.parse(readFileSync(patternsPath, "utf8"));
}

function buildPrompt(patternSet, reportText) {
  const patternBlock = patternSet.patterns
    .map((p) => `- [${p.id}] ${p.name}: ${p.description}`)
    .join("\n");

  return `You are a triage assistant for the ${patternSet.project} project. Your ONLY job is to identify vulnerability reports that describe a scenario one of the project's own documented defensive patterns already prevents -- so a maintainer doesn't have to spend time debunking it by hand.

Documented defensive patterns:
${patternBlock}

Rules, in priority order:
1. Classify as "likely-junk" ONLY if the report describes a specific attack/bug scenario that one of the patterns ABOVE, using ONLY the text of that pattern's description, demonstrably already prevents, AND the report does not identify any specific code path, condition, or edge case that would bypass that pattern. Do not use any other knowledge you have about this project's internals to justify a "likely-junk" verdict -- if a pattern's written description doesn't itself settle the question, that is not a match, no matter how confident you are about the actual code.
2. If the report describes a real code path that might bypass a pattern, or targets something none of the patterns cover, or is too vague to evaluate against a specific pattern, classify as "needs-human-review". You MAY use outside knowledge of this project's internals here, freely -- to identify a plausible bypass, flag that a pattern's premise doesn't hold, or note something the documented patterns don't address. Outside knowledge is only ever allowed to push toward "needs-human-review", never toward "likely-junk".
3. When genuinely uncertain between the two, ALWAYS choose "needs-human-review". A false "likely-junk" verdict is far worse than an unnecessary human review -- never optimize for catching more junk at the cost of this rule.

Incoming report:
"""
${reportText}
"""

Respond with ONLY a JSON object, no other text, in this exact shape:
{"verdict": "likely-junk" | "needs-human-review", "matched_pattern_id": "<pattern id or null>", "reasoning": "<one or two sentences>"}`;
}

export async function classifyReport(patternSet, reportText, { apiKey, model = "claude-sonnet-5", maxTokens = 1500 } = {}) {
  const prompt = buildPrompt(patternSet, reportText);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${JSON.stringify(json)}`);
  }

  // The response array can carry a leading "thinking" block before the
  // "text" block when extended thinking is on -- content[0] is not
  // reliably the answer.
  const text = json.content?.find((block) => block.type === "text")?.text ?? "";

  // A truncated response (stop_reason: "max_tokens") is a real, expected
  // failure mode, not a bug to crash on -- a report that makes the model
  // reason at length is exactly the kind of case where the tool must fail
  // toward human review, not toward a crash or a guessed verdict.
  if (json.stop_reason === "max_tokens") {
    return {
      verdict: "needs-human-review",
      matched_pattern_id: null,
      reasoning: "Model response was truncated before completing its verdict -- failing toward human review rather than guessing.",
      truncated: true,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model did not return valid JSON: ${text}`);
  }

  if (!["likely-junk", "needs-human-review"].includes(parsed.verdict)) {
    throw new Error(`Model returned an invalid verdict: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

export function resolveApiKey() {
  let key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const envPath = join(__dirname, "..", ".env");
    if (existsSync(envPath)) {
      const match = readFileSync(envPath, "utf8").match(/ANTHROPIC_API_KEY\s*=\s*(.+)/);
      key = match?.[1]?.trim();
    }
  }
  return key;
}
