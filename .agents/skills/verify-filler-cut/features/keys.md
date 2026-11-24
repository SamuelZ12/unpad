# Toggle and reveal

The toggle changes the lens in every tab. A Shift hold reveals the current page until release.

## Sub-features

- S6 toggles Wang and Warp together.
- S7 checks a Shift hold, release, and short press.
- S14 checks both shortcuts while typing.

## How to get to it (user POV)

On a faded page, press Option+Shift+F on macOS or Alt+Shift+F elsewhere. Hold Shift alone to reveal the original.

## Driving it with Playwright

Use a fresh test profile and let the first fade finish. Run `bun run verify S6 S7 S14`. The checks compare sentence pixels, state transitions, scroll position, and the newsletter field value.

## Gotchas

Synthetic keys reach the page listeners. They cannot trigger Chrome's extension shortcuts.
