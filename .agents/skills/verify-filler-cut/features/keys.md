# Toggle and reveal

The toggle changes the shared lens on built-in and added sites. On other sites it changes only the current document. Hold Shift to see the original until release.

## Sub-features

- S6 toggles Wang and Warp together.
- S7 checks a Shift hold, release, and short press.
- S14 checks both shortcuts while typing.
- S17 checks that Shift clears the tint.
- S12-page-mode checks the browser action with the shared lens off and with an editor focused.

## How to get to it (user POV)

On a cut page, use the switch in the toolbar popup or press Option+Shift+F on macOS or Alt+Shift+F elsewhere. Hold Shift alone to reveal the original.

## Driving it with Playwright

Use a fresh test profile and let the first cut finish. Run `bun run verify S6 S7 S14`. The checks compare kept sentence positions, state transitions, and the newsletter field value.

## Gotchas

Synthetic keys reach the page listeners. Chrome's assigned action shortcut takes precedence over the fallback page key. Page-key checks load a temporary copy of the extension with the browser shortcut unassigned.
