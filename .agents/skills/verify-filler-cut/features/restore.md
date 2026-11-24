# Restore a sentence

Click faded text to restore the sentence. The bridge logs the restore.

## Sub-features

- S8 checks click timing and persistence through toggles and reveal.
- S9 checks log contents, duplicate clicks, and retry after an outage.
- S15 checks links inside faded sentences.

## How to get to it (user POV)

Open Wang and click one faded sentence. On Warp, click a link inside a faded sentence to follow the link.

## Driving it with Playwright

Use a fresh test profile and a test bridge. Run `bun run verify S8 S9 S15`. Look for the clicked sentence's restored pixels and its event in `events.jsonl`. The link click should have zero restore events.

## Gotchas

S8 opens a visible window on macOS so it can measure the first restored frame. S15 needs picks that leave a link inside a faded sentence.
