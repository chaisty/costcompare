# Diary

One file per session. Filename format: `YYYY-MM-DD_HHMMSS_<session-id>.md`.

Written at end of session, or when the user says "we're done for now." Plan-mode sessions may skip the diary if the plan file itself is the artifact — the next execution session's entry should then reference that plan path.

## What goes in

- Decisions and why — with alternatives considered and rejected
- User-directed pivots — what the user said, how direction changed
- Surprises and lessons — what didn't work as expected
- Design tensions and tradeoffs
- Context the next agent needs that isn't in the code or commits

## What does not

Anything reconstructable from `git log`: lists of files changed, commits made, tests added. If the entry could be regenerated from the history, it has no value.

## Entry template

```markdown
# <short session title>

**Session:** `<session-id>`
**Model:** <e.g. Claude Opus 4.7>
**Date:** <YYYY-MM-DD>

## Summary
One or two sentences — what was the goal and what was the key outcome or decision.

## What happened and why
Narrative — what was tried, what worked, what didn't, what the user's intent was,
what alternatives were considered and rejected, what surprised you.

## Decisions
- <decision>: <reasoning>

## Open questions / next steps
- [ ] <follow-up items, unresolved tensions, things the next agent should know>

## Session metrics
- **Cost / tokens / duration:** <from `/cost`>
- **Lines changed:** +N / -N
- **Subagents:** N spawned (total: Xk tokens, Xms)
```

`Session metrics` is required on every new entry. Run `/cost` before writing.
