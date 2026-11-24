# Automatic fades and badge

Eligible pages fade after picks arrive. The badge shows the current selection state.

## Sub-features

- S1–S5 cover the first fade, unchanged text, dense prose, and bridge failure.
- S12 checks short posts and pages on unenabled sites.
- S12-enable-site grants an origin and checks immediate fades, future pages, and a browser restart. It also dismisses a separate grant request.
- S13 reads the per-tab toolbar badge.

## How to get to it (user POV)

Open an X status page, a Claude blog article, or an article on a site you enabled. Read the toolbar badge while picks arrive. To enable a new site, click the toolbar icon or press the toggle shortcut. Select **Allow** in Chrome's prompt.

## Driving it with Playwright

Use a fresh test profile and a test bridge. Run `bun run verify S1 S2 S3 S4 S5 S12 S12-enable-site S13`. Check the per-page fade counts, pixel comparisons, request log, and badge text in the results.

## Gotchas

The first selection on a cold cache calls Pi. S12-enable-site pre-approves each origin in Chrome settings and invokes the toolbar action through CDP.
