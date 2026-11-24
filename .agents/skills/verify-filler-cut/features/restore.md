# Expand a run

Click a ··· marker to expand that run or click a marked sentence to remove its tint for that page view. The bridge logs these as `restore` and `unmark`.

## Sub-features

- S8 checks the marker position and confirms expansion survives a toggle.
- S9 checks the restore events after a bridge outage.
- S15 checks kept links.
- S17 clicks a marked sentence twice and checks that the other marks remain and the bridge logs one unmark.

## How to get to it (user POV)

Open Wang and click one ··· marker. On Warp, click a kept link to follow the link.

## Driving it with Playwright

Use a fresh test profile and a test bridge. Run `bun run verify S8 S9 S15`. Compare the marker and the expanded run. Read each restored sentence in `events.jsonl`. The link click should have zero restore events.

## Gotchas

S8 saves dark Wang before and after expansion.
