---
name: verify-filler-cut
description: Verify the Filler Cut Chrome extension with its Playwright checks. Use after changes to selection, page fades, reading controls, navigation, the toolbar badge, or the bridge, and to record the Wang demo.
---

# Verify Filler Cut

Read the [live specification](../../../tests/live/README.md) for check IDs and pass conditions. Choose a user path from the [feature map](features/README.md).

## Launch

Run the commands from the repository root with Bun on `PATH`. On Samuel's Mini, Bun is in `~/.bun/bin`. For a fresh checkout, run `bun install` and `bunx playwright install chromium`.

A `verify` command builds and loads the extension in Playwright. Its evidence path prints at startup. Each check starts its own test bridge when needed and waits for the reference document and the expected extension state. The bridge binds `127.0.0.1:18941` and loads its reader rules at startup. The harness sets `FILLER_CUT_DATA` to a fresh `/tmp/filler-bridge-*` directory. The permanent bridge on port 18931 belongs to `scripts/bridge-service.sh` and launchd. Checks never use it.

## Doctor

If bridge startup fails, run `lsof -nP -iTCP:18941 -sTCP:LISTEN`. Before a run, no listener should appear. If another run owns the port, let that run finish. A missing Chromium binary or unreadable reader-rules file is reported at launch.

## Drive

| Situation | Command |
| --- | --- |
| Type-check and run unit tests | `bun run check` |
| Run specific checks against public X | `bun run verify <ids>` |
| Run the numbered suite against public X | `bun run verify all --mode=logged-out` |
| Run the numbered suite against captured signed-in X markup | `bun run verify all --mode=replay` |
| Run the numbered suite against the signed-in X app | `bun run verify all --mode=logged-in` |
| Record Wang in a visible window | `bun run verify demo` |

Replace `<ids>` with space-separated IDs such as `S1 S8`. To choose a mode for a specific check or the demo, append `--mode=logged-out`, `--mode=replay`, or `--mode=logged-in`.

- Use the harness's isolated `/tmp/filler-chrome-*` profiles for logged-out and replay. Never use Samuel's own Chrome profiles or ego-browser for verification.
- The logged-in test profile is `~/.pi/agent/filler-cut/x-test-profile` for the throwaway account `@fillercut_test`. Open it only through Playwright's `launchPersistentContext`, as in `tests/live/lib/browser.ts`. A raw Chrome binary stores cookies under a different keychain key. On Nov 23, 2026, this caused the next Playwright launch to drop the session without an error and the login was lost.
- In the logged-in profile, only load pages, scroll, press keys, and click article text. Leave at least 3 s between page loads. S11 follows its status link within the article.
- Real Pi calls use Samuel's Claude plan. Warm checks reuse the cache within a run. Set `FILLER_CUT_VERIFY_CACHE` to a previous run's `bridge/cache` directory to seed a new run. Cold checks clear the cache before measuring.
- Playwright keys reach the content script. They never fire Chrome's browser shortcut. Checks that exercise the fallback page key load a temporary copy of the extension with the browser shortcut unassigned. S8 needs a visible window for accurate compositor timing on macOS. The harness opens one there.
- Run `bun run verify S12-page-mode S12-added-site S12-page-check` for page mode, persistent per-origin access, and the article check. S12-page-mode sends Chrome's toolbar action through CDP. The site checks pre-approve exact origins in Chrome's extension settings and route a CDP toolbar gesture to the menu handler. Native menu interaction, the permission prompt, and a physical shortcut require native browser input.
- To update a copy that is loaded unpacked in a real Chrome, copy the new build over its folder and have the reader press the reload arrow on the extension's card. Copied files change nothing until then (measured Nov 23 2026: manifest, worker and page script all stayed old). The build names the worker by its content hash because a browser restart alone kept running the old worker next to the new manifest and page script.

## Evidence

Each run writes to `~/.pi/agent/filler-cut/evidence/<UTC timestamp>/`. Read `results.log` for the per-check outcome. Look in each check's directory for its screenshots and timing files, and in `bridge/` for request logs, event logs, and cache entries. The demo prints `demo.webm` and also `demo.mp4` when `ffmpeg` is on `PATH`.

A PASS requires the selected check to meet every assertion in the requested mode. Cite the outcome, the measurements, and the evidence. Use screenshot comparisons for paint claims and verify bridge side effects from the logs. Replay substitutes the X document and its navigation or rebuild where the test says so. Report replay evidence as replay. If X opens a dialog, report the text and the failed check.

## Cleanup

Let the harness close its browser contexts and stop its test bridge. It removes its temporary profiles and copies its bridge data into evidence before deleting the temporary data. Keep the evidence after cleanup. If interrupted, use only the run's own process IDs and temporary directories for any cleanup.

## Helpers

Use `bun run verify load` to confirm the extension loads and collect baseline screenshots. Use `bun run verify extract` to inspect sentence counts and compare the live and replay text. Use `bun run verify dark` to measure the 40% alpha blend on Wang.
