# filler-cut v0 spec

filler-cut is a Chrome extension. It fades the filler sentences on the page you are reading and leaves the key sentences at full strength. Every word on the page stays the author's. The extension never inserts, removes, or rewrites text.

This file states v0 behaviour as pass or fail checks. Each check has an id that `docs/plan.md` cites. The types and names used here are defined in `docs/architecture.md`.

## Terms

- **Doc.** One block of prose the extension treats as a unit: the body of an X Article, the text of one X post, or the article body of a blog post.
- **Picks.** The selector's answer for one doc. Picks are either "keep everything" or a list of sentence ids to keep.
- **Lens.** The global on or off switch. The toggle key flips it. It starts on.
- **Toggle key.** Option+Shift+F on a Mac, Alt+Shift+F elsewhere.
- **Reveal key.** Shift, held alone for at least 200 ms. The original shows until Shift is released.
- **Faded.** A sentence drawn in its own text colour at 40% alpha. Nothing else about the sentence changes.
- **Restored.** A faded sentence that the reader clicked. It stays at full strength.
- **Untouched.** A screenshot crop of the doc equals the reference crop. The reference crop is taken in the same page load while nothing is faded: before the bridge answers, or with the lens off.

## What v0 covers

- X status pages at `x.com/<user>/status/<id>`. They hold posts and X Articles, on both X frontends. The logged-out frontend and the logged-in app have different markup, as seen on Nov 23 2026 and recorded in `~/.pi/agent/filler-cut/v0-plan-proto/FINDINGS.md`.
- Blog posts on enabled sites. `claude.com` starts enabled. Pressing the toggle key on any other site enables that site.
- One selector. The bridge on the Mini runs Pi with Claude Opus 5.5, thinking off, and no tools. The bridge sends Pi the numbered sentences and the reader-rules file. Pi returns sentence ids.

## What v0 leaves out

- The X home feed, search, and profile timelines.
- Collapse mode, hover glosses, video, and PDF.
- A settings page. Keys and thresholds are constants in `src/shared/config.ts`.
- Recompiling the reader-rules file. v0 uses the existing `~/.pi/agent/filler-cut/engine/reader-rules.txt`.
- Browsers other than Chrome.

## How a check observes the page

Every check runs in an isolated Chrome profile under `/tmp` with the built extension loaded. No check uses one of Samuel's profiles.

A check reads three things:

- **Pixels.** A screenshot crop of a sentence or of the doc.
- **The state attribute.** The content script sets `data-filler-cut-state` on `<html>` to `idle`, `waiting`, `picks-ready`, `faded`, or `revealed`, and `data-filler-cut-faded` to the number of sentences now faded.
- **The bridge files.** The bridge request log and `events.jsonl` on the Mini.

Timing is measured from outside the extension. The harness compares the bridge log's response time with the time of the first screenshot that shows the change. The harness polls screenshots every 50 ms.

A fade or an unfade animates for at most 160 ms. A check that compares two screenshots takes them after the animation ends. With `prefers-reduced-motion`, the change has no animation.

The three reference pages:

| Name | URL |
| --- | --- |
| Wang | `https://x.com/alexandr_wang/status/2124636606959345776` |
| Perfloop | `https://x.com/tsenart/status/2123483102936785334` |
| Warp | `https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude`, which redirects to `https://claude.com/resources/articles/how-warp-builds-self-improving-agents-on-claude` |

X checks run twice: on the live logged-out page, and on the logged-in markup. The logged-in run uses a live test account when one exists. Without one, it replays the captured logged-in markup at the same URL.

## Checks

### S1. Wang fades within 1 s of picks arriving

1. Clear the bridge cache. Open Wang with the lens on.
2. Wait for the bridge log to show the response for Wang.

Pass when all of these hold:

- At most 1000 ms after the bridge response, a screenshot shows at least 3 faded sentences in the article body.
- `data-filler-cut-state` is `faded`.
- The article title and the author line are not faded.

### S2. The page text never changes

Run on Wang, Perfloop, and Warp, with the lens on and after picks arrive.

Pass when all of these hold:

- The doc root's `innerText` after the fade equals its `innerText` before the bridge answered.
- The number of elements inside the doc root is the same before and after, and no element in the root has an attribute or a class that the extension added.
- On Warp, where the page does not rewrite itself, the root's `outerHTML` is the same before and after.
- Every sentence in the bridge request log for the page is a substring of that `innerText`, after runs of whitespace are collapsed.

### S3. Perfloop stays untouched

1. Clear the bridge cache. Open Perfloop with the lens on. Wait for the bridge response.
2. Repeat 5 times.

Pass when, in 5 of 5 runs, `data-filler-cut-state` is `idle`, `data-filler-cut-faded` is `0`, and the post is untouched.

### S4. Warp fades its filler

1. Clear the bridge cache. Open the Warp `/blog/` URL with the lens on.

Pass when all of these hold:

- At most 1000 ms after the bridge response, at least 8 sentences in the article body are faded.
- No heading, table, code block, image caption, navigation link, or footer text is faded.

### S5. Picks not ready means untouched

1. Stop the bridge. Open Wang with the lens on. Wait 10 s. Press the toggle key twice.
2. Start the bridge. Reload.
3. Make the selector return invalid output. Clear the cache. Reload.

Pass when all of these hold:

- In step 1 the page is untouched at every screenshot and the state is `waiting` or `idle`.
- In step 2 the page fades as in S1.
- In step 3 the page is untouched and the state is `idle`.

### S6. One key toggles the lens

1. Open Wang. Wait for `faded`. Take screenshot A.
2. Press the toggle key. Take screenshot B.
3. Press the toggle key again. Take screenshot C.

Pass when all of these hold:

- In B the doc is untouched, and the state is `picks-ready`.
- C equals A.
- Each press reaches its state at most 100 ms after the keydown event.
- A second tab on Warp follows the same lens setting without a reload.

### S7. Holding the reveal key shows the original without moving the page

1. Open Wang. Wait for `faded`. Scroll to the middle of the article.
2. Record `scrollY` and the top of one kept sentence, to a fraction of a CSS pixel.
3. Hold the reveal key for 1 s. Record both values again. Release. Record them a third time.

Pass when all of these hold:

- While the key is held, the doc is untouched and the state is `revealed`.
- `scrollY` and the sentence top each move less than 1 px across the three readings.
- At most 100 ms after release, the state is `faded` and the same sentences are faded.
- A press shorter than 200 ms reveals nothing.

### S8. Clicking a faded sentence restores it

1. Open Wang. Wait for `faded`. Click the middle of one faded sentence.

Pass when all of these hold:

- That sentence is drawn at full strength at most 100 ms after the click. `data-filler-cut-faded` drops by exactly 1.
- No other sentence changes.
- The sentence stays restored after the lens is toggled off and on, and after a hold and release.

### S9. A restored sentence is logged as a miss

Continue from S8.

Pass when all of these hold:

- At most 5 s after the click, `events.jsonl` on the Mini has one new `restore` event. Its `text` equals the clicked sentence. Its `url` is the Wang URL. Its `cacheKey` names a cache entry that holds the sentences and the picks for the page.
- The same file has one `shown` event for this page view, with the total and faded sentence counts.
- Clicking the same sentence again adds no event.
- With the bridge stopped during the click, the event reaches `events.jsonl` after the bridge starts and the next event is sent.

### S10. Fades survive X removing and rebuilding a post

Run on the logged-in markup of Wang.

1. Wait for `faded`. Restore one sentence. Record which sentences are faded.
2. Scroll down until X removes the article from the DOM. Scroll back to the top.

Pass when, at most 200 ms after the article is back in the DOM, the same sentences are faded and the restored sentence is still restored. No new request reaches the bridge.

### S11. Moving between X pages without a reload

1. Open Wang. Wait for `faded`.
2. Follow an in-page link to another status page. Then use the browser's back button.

Pass when all of these hold:

- On the second page, no sentence from Wang's picks is faded. The second page gets its own picks or stays untouched.
- After going back, Wang fades again from the cache at most 1 s after its text is in the DOM.

### S12. Short text and other sites send nothing

1. Open an X status page whose post has fewer than 6 sentences.
2. Open `https://www.anthropic.com/engineering/building-effective-agents`, a blog post on a site that is not enabled. Do not press a key.
3. On that blog post, press the toggle key.

Pass when all of these hold:

- Steps 1 and 2 add no line to the bridge request log, and both pages are untouched.
- After step 3, the bridge log shows one request, the page fades, and a reload of the page fades it without a key press.

### S13. The toolbar badge reports the state

Pass when the extension's toolbar badge shows `…` while picks are pending, the number of faded sentences when the page is `faded` or `picks-ready`, nothing on an untouched page, and `!` when the bridge failed.

### S14. Keys stay out of the way of typing

1. On a `faded` Warp page, focus the newsletter email field.
2. Type the toggle key combination. Hold the reveal key for 1 s.

Pass when the state stays `faded` and the field receives the typed characters.

### S15. Links inside faded sentences still work

1. On a `faded` Warp page, click a link that sits inside a faded sentence.

Pass when the browser follows the link, the sentence is not restored, and no `restore` event is logged.

### S16. A cached page fades without waiting for the selector

1. Open Warp. Wait for `faded`. Reload.

Pass when the page is `faded` at most 1 s after the article text is in the DOM, and the bridge log shows a cache hit and no Pi call.
