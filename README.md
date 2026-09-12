# foss-triage-bot

A free, self-hostable AI triage tool that screens incoming security reports
against a project's own documented defensive patterns -- built for unfunded
FOSS maintainers, not enterprise security teams.

## Why I built this

When curl shut down its six-year HackerOne bug bounty program in January
2026, Daniel Stenberg's explanation was blunt: the confirmed-vulnerability
rate had fallen from "somewhere north of 15%" to "below 5%... not even one
in twenty was real." Buried in that PR's comment thread was someone
proposing almost exactly this tool: *"put a well instructed AI triage bot
at the gate. Give it all the context about curl's defensive patterns that
the junk reports are missing... your bot knows that's a documented safe
pattern -> auto-reject before it wastes human time."*

That's not an isolated complaint. Jazzband shut down entirely over AI-spam
volume. Godot's maintainers called it "draining and demoralizing." Ghostty
and tldraw both now auto-close unvetted AI-generated PRs. The general
"anti-slop PR bot" market is already saturated (multiple repos with
thousands of stars), and the enterprise vulnerability-triage market prices
and architects for companies with dedicated infrastructure, not solo
maintainers. Nothing free, self-hostable, and *specific to a project's own
codebase* existed in between -- a handful of single-purpose attempts, all
with zero traction, none referencing each other.

## How it works

A maintainer curates a small file naming their project's actual documented
defensive patterns -- the things a report would have to *not know about* to
be worth an automatic first pass. Each incoming report gets checked against
that list before a human has to read it:

- **Likely junk**: the report describes a scenario a named pattern already
  demonstrably prevents, and doesn't identify any way around it.
- **Needs human review**: everything else -- including anything vague,
  anything outside the documented patterns, and anything that identifies a
  real gap or bypass. This is the default, not an edge case.

A false auto-reject of a real vulnerability is worse than doing nothing, so
the tool is deliberately conservative: it's only allowed to reach "likely
junk" using the *written text* of a documented pattern, never the model's
own outside knowledge of the codebase -- even when that knowledge happens
to be correct, it isn't auditable by the maintainer who has to trust the
verdict, so it's not allowed to be the deciding factor.

## Try it

```
git clone https://github.com/forgepair/foss-triage-bot
cd foss-triage-bot
echo "ANTHROPIC_API_KEY=sk-..." > .env
node eval/run-eval.mjs
```

`patterns/curl.json` ships with five real, verified curl defensive
patterns (NTLM buffer bounds, cookie-count and cookie-line limits, dynbuf's
bounded growth, and the redirect protocol allow-list) as a working example
-- point `src/triage.mjs` at your own project's patterns to use it for real.

## Verification

Two independently-written eval sets, run live against the real Anthropic
API, no mocking: 30/30 correct verdicts total, including 18 calibration
controls specifically designed to catch false-rejects (unrelated reports,
reports that name a real pattern but identify a genuine bypass, vague
reports, an adversarial prompt-injection attempt embedded in report text,
and a report written entirely in Spanish). The prompt-injection case is
worth calling out specifically: a report containing a fake embedded
instruction telling the classifier to auto-reject was correctly ignored,
and the real (unrelated) technical content was routed to human review
instead.

One real design gap surfaced and got fixed during testing, not papered
over: an early run let the model justify a "likely junk" verdict using a
true-but-undocumented fact about curl's internals rather than anything in
the written pattern description. It got the right answer that time, but
the failure mode -- an unverifiable, unaudited claim deciding a rejection
-- is exactly what this tool exists to avoid. The prompt now restricts
"likely junk" to what a pattern's own text actually establishes.

## Known open items

- Only tested against curl's own defensive patterns as a worked example --
  needs real use on other projects to know how well the pattern-curation
  step generalizes.
- Anthropic-only backend so far; not yet packaged as an installable CLI.
- Pattern curation is manual by design (a maintainer writes down what they
  already know is defended) -- no automatic pattern extraction from source
  yet.

## License

MIT
