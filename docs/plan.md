# filler-cut v0 plan

v0 is a Chrome extension plus a small HTTP bridge on the Mini. On X status pages and enabled blogs, the extension sends the page's sentences to the bridge when the page loads. The bridge asks Pi which sentences to keep. The extension fades the rest, shows the original while Shift is held, restores a faded sentence on click, and logs each restore as a miss.

`docs/spec.md` states the behaviour as checks S1 to S16. `docs/architecture.md` names the types. This file orders the build as 13 PRs. Nothing in this plan is built yet. Building starts when Samuel approves the plan.

## PRs in landing order

| PR | Change | Waits for | Samuel reviews before merge |
| --- | --- | --- | --- |
| PR1 | Project scaffold and shared types | trunk | no |
| PR2 | Verification skill | PR1 | no |
| PR3 | Sentence extraction on the three surfaces | PR2 | no |
| PR4 | Selector bridge | PR1 | no |
| PR5 | Bridge as a service behind `tailscale serve` | PR4 | no |
| PR6 | Picks requested on page load | PR3, PR4 | no |
| PR7 | Fade and the toggle key | PR6 | yes |
| PR8 | Hold to reveal | PR7 | yes |
| PR9 | Event log endpoint and report | PR4 | no |
| PR10 | Click to restore, logged as a miss | PR7, PR9 | yes |
| PR11 | Fades survive X rebuilding a post, and in-page navigation | PR10 | no |
| PR12 | Sites enabled by key, and the toolbar badge | PR7 | yes |
| PR13 | Install in Samuel's Chrome | PR5, PR8, PR11, PR12 | yes, and it needs his approval to start |

## Dependency graph

```
PR1 ─┬─ PR2 ─ PR3 ─┐
     └─ PR4 ───────┴─ PR6 ─ PR7 ─┬─ PR8 ──────────┐
         ├─ PR5 ─────────────────│────────────────┤
         │                       ├─ PR12 ─────────┼─ PR13
         └─ PR9 ─────────────────┴─ PR10 ─ PR11 ──┘
```

- PR2 and PR4 both branch from trunk after PR1 and touch different files. Build them at the same time.
- PR5 and PR9 both branch from trunk after PR4. PR5 edits `bridge/install.ts` and the README. PR9 edits `bridge/events.ts`, `bridge/report.ts`, and one route in `bridge/server.ts`. Build them at the same time as PR3.
- PR8, PR10, and PR12 all edit `src/content/main.ts`. Build them at the same time if you want, and land them in table order. Rebase each on the one before it.
- PR11 waits for PR10 because S10 checks that a restored sentence stays restored.

## How to run one PR

- Give each PR to one worker with T3 `delegate_task`, `isolation: "worktree"`, on `gpt-6.2-sol` with `reasoningEffort: high`, as `~/.agents/pstack-models.md` says for feature code.
- The first line of every kickoff is `Read /Users/samuelzhang/.agents/skills/poteto-mode/worker.md before anything else.` The rest names this file, the PR id, and the goal.
- The worker reads `AGENTS.md` first. The clean-room rule applies to every PR.
- A PR is done when its unit, live, and perf boxes are all checked, with the evidence path written next to each box. Tests alone do not finish a PR.
- Every live box runs in a fresh Chrome profile under `/tmp`, through the verification skill from PR2. No box loads the extension into one of Samuel's profiles.
- From PR4 on, live boxes use a test bridge on port 18941 with its own data directory under `/tmp`. Test restores never reach Samuel's `events.jsonl`.
- X checks run on the live logged-out page and on the logged-in markup. The logged-in run replays the fixtures captured on Nov 23 2026, unless Samuel provides a test account. See "Decisions waiting for Samuel".
- For each perf box, measure the baseline on trunk before the change. Report the run count, the range, and what limits the number.

## PR1. Project scaffold and shared types

- [ ] Depends on: trunk.
- [ ] Files: `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore`, `scripts/build.ts`, `src/manifest.json`, `src/shared/types.ts`, `src/shared/keys.ts`, `src/shared/wire.ts`, `src/shared/config.ts`, `src/content/main.ts`, `src/background/sw.ts`, `tests/unit/keys.test.ts`, `tests/unit/wire.test.ts`, `README.md`.
- [ ] Change: a Bun and TypeScript project. `bun run build` writes an MV3 extension with an empty content script and an empty service worker to `dist/extension`. `src/shared` holds the types, `docKey`, and the wire parsers from `docs/architecture.md`. `bun run check` runs the type check and the unit tests. The content script matches only `https://x.com/*` and `https://claude.com/*`. X moves between pages without a reload, so the match cannot be narrowed to status URLs. The surface table decides by URL at run time.
- [ ] Result you see: `bun run check` exits 0. Chromium loads `dist/extension` without an error.
- [ ] Unit: `docKey` is equal for equal input and differs when one sentence or the title changes. Each wire parser accepts a valid message and rejects a missing field, a sentence that is not a string, and an id that is not an integer.
- [ ] Live: a script starts Playwright Chromium on a new `/tmp/filler-chrome-*` profile with `dist/extension` loaded and opens Warp. Pass when the extension's service worker is registered and the console has no error from the extension.
- [ ] Perf: metric is the wall time of `bun run check`. Probe is `time bun run check`, 5 runs. Trunk has no code, so the first measurement is the baseline. Fails above 20 s.

## PR2. Verification skill

- [ ] Depends on: PR1.
- [ ] Files: `.agents/skills/verify-filler-cut/SKILL.md`, `.agents/skills/verify-filler-cut/features/`, `.agents/skills/verify-filler-cut/scripts/`, `tests/live/lib/`, `tests/fixtures/x/` (the four files from `~/.pi/agent/filler-cut/v0-plan-proto/fixtures/`), `tests/live/baselines.json`, `package.json`.
- [ ] Change: generate the skill with `/create-verification-skill` (`/Users/samuelzhang/.agents/skills/create-verification-skill/SKILL.md`). The skill has Launch, Doctor, Drive, Evidence, Cleanup, and Helpers sections. Its helpers open a live page or replay a logged-in X fixture at its real `x.com` URL, read the state attributes, crop a doc or a sentence from a screenshot, compare two crops, and poll screenshots every 50 ms with timestamps. Evidence goes to `~/.pi/agent/filler-cut/evidence/<run>/`. Each later PR adds its feature file and its check script `tests/live/S<n>.ts`, run with `bun run verify S<n>`.
- [ ] Result you see: an agent that has never seen the repo follows `SKILL.md` and gets screenshots of the three reference pages with the extension loaded.
- [ ] Unit: the doctor script exits non-zero and names the reason when `dist/extension` is missing or older than `src`, and exits 0 after a build. The crop compare returns equal for two identical images and unequal when one pixel differs.
- [ ] Live: follow `SKILL.md` from the top. Launch, run doctor, open Wang, Perfloop, and Warp live and the two logged-in fixtures by replay, take three crops of each doc over 5 s, and clean up. Pass when the three crops of each doc are equal, the evidence directory still holds the screenshots after cleanup, and no Chromium process or `/tmp/filler-chrome-*` directory from the run remains.
- [ ] Perf: metric is page load time, from navigation start to the end of the load event, on Wang, Perfloop, and Warp. Probe is `bun run verify load-baseline`, 5 runs with the PR1 extension and 5 without, alternating. Write both sets to `tests/live/baselines.json`. Later PRs use the with-extension set as their trunk baseline. Fails when the with-extension median is above the no-extension median by more than the no-extension range.

## PR3. Sentence extraction on the three surfaces

- [ ] Depends on: PR2.
- [ ] Files: `src/core/segment.ts`, `src/content/surfaces.ts`, `src/content/anchor.ts`, `src/content/main.ts`, `tests/unit/segment.test.ts`, `tests/unit/anchor.test.ts`, `tests/fixtures/blog/warp.html`, `tests/live/extract.ts`, one feature file in the skill.
- [ ] Change: `extract(document, url)` returns the `AnchoredDoc` list. The surface table has rows for the X app, the logged-out X page, and a generic blog page. A development build writes the docs it found, with their sentences, to `data-filler-cut-debug` on `<html>`. A production build does not.
- [ ] Result you see: on each reference page the debug attribute lists one doc with its sentences. Nothing on the page looks different.
- [ ] Unit: `segment` splits Perfloop's text into 10 sentences, including "…open source." and "155 today, in 36 projects." as two. It does not split after "e.g." or inside a quotation. The sentences of a block, joined, equal the block text after whitespace is collapsed. On each of the four X fixtures and the Warp fixture, `extract` returns one doc with the expected surface, and each range's text equals its sentence.
- [ ] Live: `bun run verify extract`. Pass when Wang gives one `x-article` doc with 26 to 32 sentences, Perfloop gives one `x-post` doc with 10 sentences, and Warp gives one `blog` doc with 65 to 85 sentences and no text from a `nav`, `header`, `footer`, `aside`, or `form` element. The logged-in replays of Wang and Perfloop give the same sentence lists as the live pages. No reply under a post produces a doc. Every sentence is a substring of the doc root's `innerText` after whitespace is collapsed. Each doc is untouched.
- [ ] Perf: metric is the time of one `extract` pass on Warp, measured with `performance.now()` in the development build and reported in the debug attribute. 5 page loads. Prototype baseline is 1.9 ms for 80 sentences. Fails when the median is above 20 ms. Second metric is page load time against `tests/live/baselines.json`. Fails when the median rises by more than the baseline range.

## PR4. Selector bridge

- [ ] Depends on: PR1.
- [ ] Files: `bridge/server.ts`, `bridge/selector.ts`, `bridge/cache.ts`, `bridge/config.ts`, `bridge/prompt.txt`, `bridge/bench.ts`, `tests/unit/selector.test.ts`, `tests/unit/cache.test.ts`, `tests/fixtures/sentences/` (Wang, Perfloop, and Warp, from `~/.pi/agent/filler-cut/engine/*.spans`), the skill's Launch and Doctor sections.
- [ ] Change: a Bun HTTP server with `POST /select` and `GET /health`. It builds the prompt from `bridge/prompt.txt`, the reader-rules file, and the numbered sentences. It runs `pi -p --no-session --no-tools --no-extensions --no-mcp --model anthropic/claude-opus-5-5 --thinking off` with standard input from `/dev/null` and a 20 s timeout. `parseSelection` checks the answer. The cache and the request log live in the data directory. The prompt starts from the one in `~/.pi/agent/filler-cut/engine/run.py`, changed so that Pi answers with a JSON array of keep ids or the string `"ALL"` and nothing else.
- [ ] Result you see: `curl` posts Wang's sentences to the bridge and gets keep ids back. The second call returns at once from the cache.
- [ ] Unit: `parseSelection` returns `keep-all` for `"ALL"`, `keep` for integers and for digit strings, and an error for an id out of range, a repeated id, an empty array, and prose. A `keep` that fades fewer than 3 sentences becomes `keep-all`. The cache key changes when the rules bytes, the prompt, or `MIN_FADED` changes. Two overlapping requests for one key start one Pi process. A leftover temporary cache file is ignored. An invalid answer is retried once. The Pi process is killed at the timeout.
- [ ] Live: start the test bridge on port 18941 and run `bun bridge/bench.ts --runs 5`, which posts the three fixtures over HTTP with real Pi and clears the cache before each call. Pass when Perfloop is `keep-all` in 5 of 5, Wang is `keep` with at least 3 faded in 5 of 5, Warp is `keep` with at least 8 faded in 5 of 5, and no call errors. Run it again without clearing the cache. Pass when all 15 are cache hits and the request log shows no Pi call. A body that is not valid returns 400. With `pi` missing from `PATH`, the bridge returns 502 and writes no cache file.
- [ ] Perf: metric is `/select` latency with a cold cache, from `bridge/bench.ts`, 15 calls, with `uptime` recorded. Prototype baseline is a 2218 ms median, range 1739 to 2532 ms, n=15. The limit is the fixed cost of one Pi call, 1.83 s for a one-word reply. Fails when the median is above 4000 ms. Second metric is cache-hit latency. Measure it first on this branch. Fails when the median is above 20 ms.

## PR5. Bridge as a service behind `tailscale serve`

- [ ] Depends on: PR4.
- [ ] Files: `bridge/install.ts`, `bridge/com.fillercut.bridge.plist`, `README.md`, the skill's Doctor section.
- [ ] Change: `bun run bridge:install` copies the reader-rules file to `~/.pi/agent/filler-cut/data/`, installs a launchd agent that runs the bridge on `127.0.0.1:18931`, and adds `tailscale serve --https=18931`. The command reads the current state and applies only what is missing. `bun run bridge:uninstall` removes all three.
- [ ] Result you see: `https://mac-mini.tail26e02f.ts.net:18931/health` answers from any device on the tailnet, and keeps answering after a restart of the Mini.
- [ ] Unit: the plist renderer gives the expected file for a given home directory and Bun path. The planner returns no steps when the launchd agent and the serve entry already exist.
- [ ] Live: run `bun run bridge:install` twice. Pass when `launchctl list` shows one `com.fillercut.bridge` job, `tailscale serve status` shows one entry for port 18931, and `curl https://mac-mini.tail26e02f.ts.net:18931/health` returns both versions. Kill the bridge process. Pass when `/health` answers again within 5 s. In a fresh Chromium profile with the production build, the service worker fetches `/health` over the HTTPS URL without an error.
- [ ] Perf: metric is the time from killing the bridge to the next healthy answer, 5 runs. Fails above 5 s. Second metric is the service worker's `/health` round trip over HTTPS on the Mini, 20 calls. Prototype baseline is a 1.0 to 1.2 ms median for an echo. Fails when the median is above 20 ms.

## PR6. Picks requested on page load

- [ ] Depends on: PR3, PR4.
- [ ] Files: `src/core/state.ts`, `src/background/sw.ts`, `src/content/main.ts`, `tests/unit/state.test.ts`, `tests/unit/sw.test.ts`, `tests/live/S5.ts`, one feature file in the skill.
- [ ] Change: `reduce`, `fadedIds`, and `view` from `docs/architecture.md`. The content script dispatches `doc-found` for each new `DocKey` and asks the service worker for picks. The service worker posts to `/select` and returns the parsed answer. The content script writes `data-filler-cut-state` and `data-filler-cut-faded`. `lensOn` is fixed to `false` in this PR, so nothing is painted.
- [ ] Result you see: on Wang the state attribute goes from `waiting` to `picks-ready`. On Perfloop it goes from `waiting` to `idle`. The pages look the same as before.
- [ ] Unit: `reduce` handles each `PageEvent`. `view` returns each of its five values for the facts in the table in `docs/architecture.md`. `fadedIds` leaves out kept and restored ids and is empty while the lens is off or a key is held. An answer for an unknown `DocKey` changes nothing. A second `doc-found` for a known doc keeps its picks. A failed fetch gives `picks-failed`.
- [ ] Live: `bun run verify S5`, steps 1 and 3 of S5, plus the state sequences above on Wang, Perfloop, and Warp with a cold cache. Pass when each page reaches its end state, each doc is untouched the whole time, and after 15 s idle and a scroll to the bottom the bridge log shows exactly one request for each doc.
- [ ] Perf: metric is the time from the doc text being in the DOM to `picks-ready` on Wang, 5 cold runs and 5 warm runs. Baseline is the PR4 `/select` median measured on trunk. Fails when the cold median is more than 500 ms above that baseline, or the warm median is above 300 ms.

## PR7. Fade and the toggle key

- [ ] Depends on: PR6.
- [ ] Files: `src/content/paint.ts`, `src/content/keys.ts`, `src/content/main.ts`, `src/background/sw.ts`, `src/shared/config.ts`, `tests/unit/paint.test.ts`, `tests/unit/keys.test.ts`, `tests/live/S1.ts`, `S2.ts`, `S3.ts`, `S4.ts`, `S6.ts`, `S16.ts`, one feature file in the skill.
- [ ] Change: `paint` fills one CSS Custom Highlight with the ranges of `fadedIds`. A faded sentence is drawn in its own text colour at 40% alpha, with a 160 ms change that `prefers-reduced-motion` turns off. `lensOn` moves to `chrome.storage.local`, starts `true`, and is flipped by Option+Shift+F. Every tab follows `storage.onChanged`.
- [ ] Result you see: Wang and Warp fade when picks arrive. Perfloop does not change. Option+Shift+F switches the fade off and on at once.
- [ ] Unit: the function that picks ranges for a doc returns exactly the ranges of the faded ids. The toggle matcher accepts Option+Shift+F, rejects F alone and Shift+F, and ignores events from an input, a textarea, a select, and a contenteditable element. `reduce` with `lens-set` changes `view` between `faded` and `picks-ready`.
- [ ] Live: `bun run verify S1 S2 S3 S4 S5 S6 S16` on the live pages, and S1 and S2 on the logged-in replay of Wang. Also open Wang with the dark colour scheme. Pass when a faded sentence's text pixels match the page's text colour at 40% alpha over the background, within 8 levels per channel.
- [ ] Perf: metric is the time from the bridge response to state `faded`, and from the toggle keydown to the new state, on Warp, 10 runs each. Prototype baseline is 0.2 ms to set a highlight of 14 ranges. Fails when either median is above 100 ms. Second metric is the longest main-thread task while the fade is applied on Warp, from a Chromium trace. Fails above 50 ms.
- [ ] Samuel reviews the look from the evidence screenshots and one screen recording before merge.

## PR8. Hold to reveal

- [ ] Depends on: PR7.
- [ ] Files: `src/content/keys.ts`, `src/content/main.ts`, `tests/unit/hold.test.ts`, `tests/live/S7.ts`, `S14.ts`, one feature file in the skill.
- [ ] Change: a hold detector dispatches `hold-start` when Shift has been down alone for 200 ms and `hold-end` when Shift is released or the window loses focus.
- [ ] Result you see: holding Shift shows the original page. Releasing Shift brings the fade back. The page does not move.
- [ ] Unit, with fake timers: Shift down and up after 150 ms gives no event. Shift down for 250 ms gives `hold-start` at 200 ms and `hold-end` at release. Another key pressed before 200 ms cancels the hold. A window blur during a hold gives `hold-end`. A Shift press in an editable element gives no event.
- [ ] Live: `bun run verify S7 S14` on live Wang and live Warp, and S7 on the logged-in replay of Wang.
- [ ] Perf: metric is the movement of `scrollY` and of one kept sentence's top across faded, revealed, and faded again, 5 runs. Prototype baseline is 0 px. Fails at 1 px or more. Second metric is the time from the 200 ms mark to untouched pixels. Fails above 100 ms.
- [ ] Samuel reviews the feel of the hold in the screen recording before merge.

## PR9. Event log endpoint and report

- [ ] Depends on: PR4.
- [ ] Files: `bridge/events.ts`, `bridge/report.ts`, `bridge/server.ts`, `tests/unit/events.test.ts`, `tests/unit/report.test.ts`, `tests/fixtures/events/`.
- [ ] Change: `POST /events` parses a batch of `LogEvent` and appends one line per event to `events.jsonl`. `bun run report` prints the miss rate, each restored sentence with its page, and the reveal count per page.
- [ ] Result you see: after a posted `restore` event, `bun run report` lists that sentence and its page.
- [ ] Unit: the parser rejects an unknown type and a `restore` without `text`. The report counts each event id once. For a fixture log with 2 pages, 30 faded sentences shown, and 3 restores, the report prints 10%. A restore whose `cacheKey` has no cache file is listed as an unknown page.
- [ ] Live: post 3 events to the test bridge with `curl`, then post the same 3 again. Pass when `events.jsonl` has 6 lines and the report counts 3 events. A body that is not valid returns 400 and appends nothing.
- [ ] Perf: metric is the `/events` round trip for a batch of 1, 20 calls. Measure the trunk echo first. Fails when the median is above 20 ms. Second metric is `bun run report` on 10,000 generated events. Fails above 2 s.

## PR10. Click to restore, logged as a miss

- [ ] Depends on: PR7, PR9.
- [ ] Files: `src/content/click.ts`, `src/content/main.ts`, `src/background/sw.ts`, `tests/unit/click.test.ts`, `tests/unit/queue.test.ts`, `tests/live/S8.ts`, `S9.ts`, `S15.ts`, one feature file in the skill.
- [ ] Change: a click handler maps the click point to a sentence with `document.caretPositionFromPoint`. A click inside a faded sentence dispatches `restore` and creates a `restore` event. The first paint of a faded doc in a page view creates a `shown` event. The service worker posts events to `/events` and keeps unsent events in `pendingEvents`.
- [ ] Result you see: a click on a faded sentence brings it back, and the sentence appears in `events.jsonl` on the test bridge.
- [ ] Unit: the hit test returns the sentence that contains a node and offset, and nothing for a point between docs. A click on a link, and a click that ends a text selection, restore nothing. The event id is the same for the same page view, doc, and sentence. A failed post leaves the events in the queue, and the next successful post sends them in order.
- [ ] Live: `bun run verify S8 S9 S15` on live Wang and live Warp, and S8 on the logged-in replay of Wang.
- [ ] Perf: metric is the time from the click to restored pixels, 10 runs. Fails when the median is above 100 ms. Second metric is the click handler's time for a click outside any faded sentence, 100 clicks, from `performance.now()` in the development build. Measure trunk first, which has no handler. Fails when the median is above 1 ms.
- [ ] Samuel reviews the click behaviour in the screen recording before merge.

## PR11. Fades survive X rebuilding a post, and in-page navigation

- [ ] Depends on: PR10.
- [ ] Files: `src/content/observe.ts`, `src/content/main.ts`, `tests/live/lib/replay.ts`, `tests/unit/observe.test.ts`, `tests/live/S10.ts`, `S11.ts`, one feature file in the skill.
- [ ] Change: one debounced `MutationObserver` and a URL watcher call `extract` and then `paint`. A doc whose nodes were rebuilt gets new ranges under the same `DocKey`. A URL change dispatches `navigated`.
- [ ] Result you see: on X, a faded article that scrolls out and back is still faded, and a restored sentence is still restored.
- [ ] Unit: a burst of 100 mutations causes one `extract` call. After `navigated`, docs that are not on the page are dropped. A rebuilt doc with the same text gets the same `DocKey` and sends no request.
- [ ] Live: `bun run verify S10 S11`. S10 runs on the logged-in replay of Wang, where the replay helper removes the post's cell and builds it again from the same markup, 5 times. With a test account, S10 also runs on the live page by scrolling. S11 runs on live logged-out X. Record whether the logged-out page navigates in place or reloads.
- [ ] Perf: metric is the extension's main-thread time while the replay helper inserts and removes 500 cells over 10 s, from a Chromium trace. Measure trunk first. Fails when the total is above 100 ms or one task is above 16 ms. Second metric is the time from the cell returning to faded pixels. Prototype baseline is 0.3 ms to rebuild 28 ranges. Fails above 200 ms.

## PR12. Sites enabled by key, and the toolbar badge

- [ ] Depends on: PR7.
- [ ] Files: `src/manifest.json`, `src/content/main.ts`, `src/background/sw.ts`, `src/shared/config.ts`, `tests/unit/sites.test.ts`, `tests/live/S12.ts`, `S13.ts`, one feature file in the skill.
- [ ] Change: the content script matches all `http` and `https` pages and does nothing but listen for the toggle key on an origin that is not in `enabledOrigins`. `x.com` and `claude.com` start enabled. The toggle key on another origin adds that origin and turns the lens on. The service worker sets the toolbar badge from `view`.
- [ ] Result you see: on a new blog nothing happens until Option+Shift+F. After that the blog fades on every visit. The toolbar badge shows what the extension is doing.
- [ ] Unit: on an origin that is not enabled, `extract` is never called. The toggle on such an origin adds it once. The badge text for each `view` value matches S13.
- [ ] Live: `bun run verify S12 S13`, with `https://www.anthropic.com/engineering/building-effective-agents` as the site that is not enabled. The badge is read with `chrome.action.getBadgeText` from the service worker.
- [ ] Perf: metric is the content script's total time on a page that is not enabled, 5 loads, and the number of bridge requests from it. Fails above 5 ms or at any request. Second metric is that page's load time against a no-extension run, 5 alternating runs. Fails when the median rises by more than the no-extension range.
- [ ] Samuel reviews the enable-by-key behaviour and the badge before merge.

## PR13. Install in Samuel's Chrome

- [ ] Depends on: PR5, PR8, PR11, PR12, and Samuel's approval to load an unpacked extension in his Chrome.
- [ ] Files: `README.md`, `scripts/build.ts`, `tests/unit/manifest.test.ts`.
- [ ] Change: a production build and an install runbook. The production build points at `https://mac-mini.tail26e02f.ts.net:18931` and has no debug attribute.
- [ ] Result you see: filler-cut runs in Samuel's Chrome on the MacBook, and his restores appear in `~/.pi/agent/filler-cut/data/events.jsonl` on the Mini.
- [ ] Unit: the built manifest lists only the bridge URL under `host_permissions`. The built content script does not contain the string `data-filler-cut-debug`.
- [ ] Live, by the agent: `ssh macbook curl -s https://mac-mini.tail26e02f.ts.net:18931/health` returns both versions.
- [ ] Live, by Samuel: he loads `dist/extension` in his Chrome and opens Wang, Perfloop, and Warp, logged in. Pass when Wang and Warp fade, Perfloop does not, holding Shift shows the original, and one click restores a sentence. The agent then confirms that the bridge log has his three requests and that `events.jsonl` has his `restore` event.
- [ ] Perf: metric is the `/health` round trip from the MacBook, 20 calls through `ssh macbook`. The MacBook was offline on Nov 23 2026, so no baseline exists. Fails when the median is above 150 ms. Second metric is the time from opening Wang in his Chrome to faded text with a cold cache, read from the bridge log and his report. Fails above 5 s.

## Decisions waiting for Samuel

1. **A test account for X.** The checks run logged out, and logged-out X serves different markup from the app Samuel uses. With a throwaway X account logged in to the test profile, S1, S10, and S11 run against the real app. Without it, the logged-in app is checked by replaying captured markup, and first proven live in PR13.
2. **The keys.** Option+Shift+F toggles. Holding Shift alone for 200 ms reveals.
3. **The lens starts on.** An enabled page fades by itself when picks arrive, about 2 s after the text loads.
4. **Scope.** X status pages and `claude.com` start enabled. Any other site is enabled by pressing the toggle key there. The X home feed is out of v0.
5. **How much to cut.** The current prompt faded 14 to 24% of Wang's sentences and 32 to 41% of Warp's. The hand-picked demo kept only 21 to 24% of the words. Either keep this prompt for the first week or ask for a harder cut first.
6. **Cost and privacy.** Each new doc on an enabled site is one Opus call on the Claude plan through Pi, and its text goes to the Mini and to Anthropic.
7. **Machine changes.** PR5 adds a launchd agent and a `tailscale serve` port on the Mini. PR13 loads an unpacked extension in his Chrome.

## What stays unproven

- The MacBook leg. The MacBook was offline, so the HTTPS route from his Chrome to the bridge and its latency are unmeasured. The transport numbers are from Chromium on the Mini.
- The extension on the logged-in X app. The fade, the rebuild after scrolling, and the click hit test were checked there with page-level JavaScript in ego lite, not with an extension.
- Pick quality. Five runs per page show that the picks are stable enough for the density rule. They do not show that the picks are the sentences Samuel wants. The first week of `restore` events is the test, and a restore only catches a sentence that was wrongly faded. It does not catch a page that was cut too little.
- The density rule's margin. Perfloop faded at most 1 sentence and Wang at least 4, with `MIN_FADED` at 3, over 5 runs each.
- Selector latency. The median was 2.2 s on Nov 23 2026 at 17:00 and 0.9 to 1.5 s in the bench three hours earlier. A one-word Pi call took 1.83 s at 17:12, so the fixed cost of a call sets the number. That cost was lower during the earlier bench, and the cause is not known.
- Blog pages other than Warp. The generic root picker found 159 sentences on the Anthropic post. It fell back to `<body>` on a page with no `article` or `main` element.
- Key conflicts. Option+Shift+F and a held Shift were not tried against X's own shortcuts or on Samuel's keyboard.
- The 40% alpha rule on X's themes. The prototype used a fixed grey on the dark theme only.
