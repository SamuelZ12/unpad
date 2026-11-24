# Automatic fades and badge

Eligible pages fade after picks arrive. The badge shows the current selection state.

## Sub-features

- S1–S5 cover the first fade, unchanged text, dense prose, and bridge failure.
- S12 checks short posts and pages on unenabled sites.
- S13 reads the per-tab toolbar badge.

## How to get to it (user POV)

Open an X status page or a Claude blog article with the lens on. Read the extension's toolbar badge while picks arrive.

## Driving it with Playwright

Use a fresh test profile and a test bridge. Run `bun run verify S1 S2 S3 S4 S5 S12 S13`. Check the per-page fade counts, pixel comparisons, request log, and badge text in the results.

## Gotchas

The first selection on a cold cache calls Pi. `S12-enable-site` requires an unapproved permission and stays unavailable.
