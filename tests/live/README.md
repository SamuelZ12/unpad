# Filler Cut live specification

Filler Cut fades filler in X status pages, Claude blog articles, and articles on sites you add. Key sentences stay at full strength, in the author's words and in their original place. Click the toolbar icon or press Option+Shift+F on macOS or Alt+Shift+F elsewhere. On a new site, this fades only the current document without a permission prompt. Press again to toggle its fades. Reloading or leaving ends page mode. On a built-in or added site, the same action toggles the shared lens.

To add a site, right-click the toolbar icon, check **Always run on this site**, and allow access in Chrome's prompt. This turns the lens on and starts it in the open tab. Uncheck the same item to stop automatic fades and remove the grant. Built-in sites show the item checked and disabled. On added sites with the generic extractor, a page needs five non-list blocks of at least 40 words before the extension sends a selection request. Pi checks whether the page is an article in the same call that picks sentences. A skipped page stays untouched and its badge clears. Page mode runs on demand without either article check.

On an update from 0.0.2 or 0.0.3, Filler Cut clears optional site grants made under the old toolbar behavior. Add sites through the menu to resume automatic fades.

Hold Shift alone for 200 ms to see the original until release, or click a faded sentence to bring that sentence back. The bridge records restores in site mode, and the toolbar badge reports the page's state.

## Terms

- **Doc.** The body of an X Article, the text of one X post, or the body of a blog article.
- **Picks.** The selector's answer for a doc. It skips the doc, keeps everything, or names the sentence IDs to keep.
- **Lens.** The on or off setting. Site mode shares it across tabs and starts on. Page mode keeps its own setting for the current document.
- **Faded.** A sentence drawn in its own text colour at 40% alpha. Its text and layout stay the same.
- **Restored.** A faded sentence that the reader clicked. It stays at full strength for that page view.
- **Untouched.** A screenshot crop of the doc matches the original crop from the same page load. Capture the original before picks arrive or with the lens off.

## Checks

Run `bun run verify all` for the numbered checks or pass individual IDs. The default `logged-out` mode uses public X. `replay` serves captured signed-in X markup at its original URL. `logged-in` uses the dedicated Playwright test profile. Warp, Anthropic, and GitHub use live pages. See the [verification skill](../../.agents/skills/verify-filler-cut/SKILL.md) for profile rules and evidence paths.

| ID | Behaviour | Modes |
| --- | --- | --- |
| [S1](S1.ts) | Wang fades at least 3 sentences within 1000 ms of the bridge response. | All |
| [S2](S2.ts) | Wang, Perfloop, and Warp keep their text and document structure. | All |
| [S3](S3.ts) | Perfloop stays untouched on 5 cold loads. | All |
| [S4](S4.ts) | Warp fades at least 8 prose sentences within 1000 ms of the bridge response. | All |
| [S5](S5.ts) | Wang stays untouched without valid picks and fades after the bridge restarts. | All |
| [S6](S6.ts) | A key toggles the lens across tabs. | All |
| [S7](S7.ts) | Hold Shift to reveal the original without moving the page. | All |
| [S8](S8.ts) | A click restores exactly one sentence within 100 ms. | All |
| [S9](S9.ts) | A restore is logged once, including after an outage. | All |
| [S10](S10.ts) | Fades and restores survive X rebuilding an article. | Replay or logged-in. Logged-out requests use replay. |
| [S11](S11.ts) | A second status gets no stale fades, and Back restores Wang's fades from the cache. | All |
| [S12](S12.ts) | A short X post and an unenabled site stay untouched and send no requests. | Live logged-out pages in every suite |
| [S12-page-mode](S12-page-mode.ts) | Chrome's toolbar action fades the Anthropic article with the shared lens off. A focused editor blocks activation. Subsequent actions toggle the document and a reload ends page mode. Permissions, registered scripts, and extension storage stay the same. | Live logged-out page in a fresh profile in every suite |
| [S12-added-site](S12-added-site.ts) | Adding Anthropic registers the exact origin, turns the lens on, and fades the open article and its reload. Removing it clears the fade, grant, and registration. Menu updates follow the active tab and show a built-in site checked and disabled. | Live logged-out pages in a fresh profile in every suite |
| [S12-page-check](S12-page-check.ts) | With GitHub added, the Firecrawl README receives SKIP and has an empty badge and unchanged prose pixels. Reload reuses SKIP from cache. SamuelZ12's profile sends zero selection requests. A checked article on added Anthropic still fades. | Live logged-out pages in a fresh profile in every suite |
| [S13](S13.ts) | The toolbar badge reports pending picks, a fade count, an untouched page, or a bridge failure. | All |
| [S14](S14.ts) | The lens and reveal keys leave typing alone. | All |
| [S15](S15.ts) | Links in faded text still work and produce no restore. | All |
| [S16](S16.ts) | Warp fades from the cache within 1 s after its text is in the DOM. | All |

The reference pages are the [Wang X Article](https://x.com/alexandr_wang/status/2124636606959345776), the [Perfloop X post](https://x.com/tsenart/status/2123483102936785334), and the [Warp article](https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude). Warp's `/blog/` URL redirects to `/resources/articles/`.

## What a check observes

- **Pixels and DOM.** Compare PNG crops, sentence positions, and snapshots of the page's own text and elements. The fade and unfade take at most 160 ms. With reduced motion they happen immediately. Compare settled frames for equality. Timing checks use the first qualifying frame they capture. The polling helpers aim for a 50 ms interval, and some timing checks also read Chromium's screencast timestamps.
- **Extension state.** Read `data-filler-cut-state` on `<html>` for `idle`, `waiting`, `picks-ready`, `faded`, or `revealed`. Read `data-filler-cut-faded` for the current painted sentence count. S13 reads the per-tab badge through the service worker with `chrome.action.getBadgeText`.
- **Bridge evidence.** Read `requests.jsonl` for responses, cache hits, and Pi calls. Read `events.jsonl` for what the reader saw or clicked. The selection timing checks compare the logged response time with the browser's screenshot timestamps.

## Findings behind the checks

- On Nov 23, 2026, public X used `[data-article-body-html]` with paragraphs for Articles and `div[dir=auto][lang]` for post text. Replies appeared in a plain list. The signed-in React app used `[data-testid=twitterArticleRichTextView] [data-block=true]` for Articles and `[data-testid=tweetText]` for posts. Its virtualized `[data-testid=cellInnerDiv]` cells move with `translateY`. S11 records whether public X opens a new document. Replay and the signed-in app must navigate within the same document.
- Scrolling to 18,989 px in the signed-in Wang thread removed the Article. All 14 test ranges lost their anchors. Scrolling back produced new nodes with the same 28 sentences, and rebuilding 28 ranges took 0.3 ms. A `DocKey` hashes the title and the sentences so picks and restores survive replacement nodes within a page view.
- Ranges and the CSS Custom Highlight API change paint without inserting elements into the page's DOM. In the prototype, the kept sentence stayed at 327 px before and after the fade. The highlight does not provide click targets, so the extension uses `document.caretPositionFromPoint` to find the text under the click.
- Chrome's `_execute_action` shortcut and the toolbar icon invoke the same action. The content script toggles from a page key only when the action has no assigned shortcut. Shift reveal still uses the page's key-down and key-up events. Chromium's synthetic Playwright keys reach the page and invoke the Chrome action zero times.
- An OS-level Alt+Shift+F sent through X11 on Linux Chromium 156 invoked the action once. The page received the modifier events and zero `KeyF` events. macOS Chromium 159 reported an assigned Option+Shift+F shortcut. The macOS login window prevented the OS-level key probe from reaching Chromium.
- S12-page-mode uses Chromium's `Extensions.triggerAction`. S12-added-site and S12-page-check pre-approve each exact origin in Chrome's extension settings, then route a CDP toolbar gesture to the same handler as the toolbar menu. The checks exercise the real permission request, grant, registration, and menu update calls. Native menu rendering and clicks, Chrome's permission prompt and its buttons, and a physical shortcut require native browser input.
- The bridge receives docs with 6 to 400 sentences. If picks would fade fewer than 3, it keeps everything so dense posts stay readable. In 5 prototype runs per page, Perfloop would have faded 0 to 1 of 10 sentences and Wang 4 to 7 of 29. The later Wang markup yielded 28 sentences.
- The bridge cache is keyed by doc, selector version, reader-rules version, and the check URL when present. The check URL contains the origin and pathname. Checked and unchecked requests use different keys. Returning to a page can reuse picks or a SKIP verdict with one bridge request.

The measurement setup and raw paths are in `~/.pi/agent/filler-cut/v0-plan-proto/FINDINGS.md`.
