# Navigate and return

Cuts stay with their document. Returning to an article restores the appropriate cuts after X rebuilds it or after the bridge supplies cached picks.

## Sub-features

- S10 checks an article rebuilt after scrolling.
- S11 follows a status link, then returns with Back.
- S16 reloads a cached Warp article.

## How to get to it (user POV)

On the signed-in X app, scroll from Wang into the replies and back. Follow a status link from Wang and use Back. On Warp, reload a cut article.

## Driving it with Playwright

Run `bun run verify S10 S11 S16 --mode=replay`. The checks compare the rebuilt cuts, the second status, Wang's return timing, and Warp's cache hit.

## Gotchas

Replay replaces the article cell and simulates same-document navigation. Use the signed-in mode to test X's own virtualization. Public X can open a new document, and may intercept a status click with a sign-in dialog.
