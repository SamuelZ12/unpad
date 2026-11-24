# Toggle and reveal

The toggle changes the shared lens on built-in and added sites. On other sites it changes only the current document. A Shift hold hides fades and marks until release.

## Sub-features

- S6 toggles Wang and Warp together.
- S7 checks a Shift hold, release, and short press.
- S14 checks both shortcuts while typing.
- S17 checks that Shift and lens off hide both fades and marks.
- S12-page-mode checks the browser action with the shared lens off and with an editor focused.

## How to get to it (user POV)

On a faded page, click the toolbar icon or press Option+Shift+F on macOS or Alt+Shift+F elsewhere. Hold Shift alone to reveal the original.

## Driving it with Playwright

Use a fresh test profile and let the first fade finish. Run `bun run verify S6 S7 S14`. The checks compare sentence pixels, state transitions, scroll position, and the newsletter field value.

## Gotchas

Synthetic keys reach the page listeners. Chrome's assigned action shortcut takes precedence over the fallback page key. Page-key checks load a temporary copy of the extension with the browser shortcut unassigned.
