# Automatic cuts and badge

Eligible pages show cuts and key sentence marks after picks arrive. The badge counts removed sentences.

## Sub-features

- S1–S5 cover the first cut, unchanged text, dense prose, and bridge failure.
- S12 checks short posts and pages on sites you haven't added.
- S12-page-mode checks removal, toggling, and reload after a toolbar action on a new site.
- S12-added-site checks the exact origin grant, immediate cuts, a reload, and removal.
- S12-page-check checks a skipped README, a profile that sends nothing, and an article that cuts.
- S13 reads the per-tab toolbar badge.
- S17 and S18 check tint, mark limits, and separation from the cuts.

## How to get to it (user POV)

Open an X status page, a Claude blog article, or an article on a site you added. Read the toolbar badge while picks arrive. On a new site, use the switch in the toolbar popup or press the toggle shortcut to cut the current document. To enable automatic cuts, open the popup, check **Always run on** for the site, and select **Allow** in Chrome's prompt.

## Driving it with Playwright

Use a fresh test profile and a test bridge. Run `bun run verify S1 S2 S3 S4 S5 S12 S12-page-mode S12-added-site S12-page-check S13 S17 S18`. Check the per-page cut and mark counts, pixel comparisons, request log, and badge text in the results.

## Gotchas

An uncached extension request on a document with at least 20 sentences makes two Pi calls in parallel. The site checks pre-approve each origin in Chrome settings and drive the same handler as the toolbar menu. S12-page-mode invokes the toolbar action through CDP.
