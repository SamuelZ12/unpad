# Live Filler Cut checks

The lens removes filler from the layout and marks key sentences in yellow. A small inline **···** marks each stretch of consecutive removed sentences. Hover to read its sentence count. Click it to expand that stretch for the rest of the page view. The marker disappears and the returned text starts at its position. Click a marked sentence to remove its tint.

Toggle the lens with the switch in the toolbar popup or Option+Shift+F on macOS and Alt+Shift+F elsewhere. Hold Shift alone for 200 ms to see the original until release. The lens keeps a visible sentence at the same height as the text reflows. Turning the lens off restores the site's text and markup. The toolbar badge counts removed sentences and goes down when you expand a stretch.

On an unenabled site, the popup switch or shortcut starts page mode without a permission prompt. Reloading or leaving ends page mode. To enable automatic cuts, open the popup, check **Always run on** for the site, and approve access in Chrome. On these added sites, the generic extractor needs five non-list prose blocks of at least 40 words. Pi checks whether the page is an article. A skipped page stays untouched. Page mode bypasses both article checks.

## Run the checks

Run `bun run check` for the type checker and unit tests. Run each live suite from the repository root.

```sh
bun run verify all --mode=logged-out
bun run verify all --mode=replay
bun run verify all --mode=logged-in
```

The harness prints the evidence directory and writes `results.log`. It also saves screenshots, bridge logs, and console captures. See the instructions for the isolated Chrome profiles and test bridge. [Verification skill](../../.agents/skills/verify-filler-cut/SKILL.md)

| Check | Pass condition |
| --- | --- |
| [S1](S1.ts) | Cold Wang reflows within 1 s of the bridge response. Every removed sentence is absent. Markers identify the runs. Title and byline pixels stay the same. |
| [S2](S2.ts) | Lens off restores the original Wang and Warp text and clears the extension's elements. Warp's full article HTML matches the original. |
| [S3](S3.ts) | Five cold Perfloop loads stay untouched. There are zero removed sentences and zero changed prose pixels. |
| [S4](S4.ts) | Cold Warp reflows within 1 s of the bridge response. Excluded content such as headings, captions, and tables keeps its text. |
| [S5](S5.ts) | Wang stays untouched with the bridge down or with invalid picks. Restart and reload show the selected cuts. |
| [S6](S6.ts) | Toggling the shared lens restores Wang and Warp in their existing tabs. Toggling it back recuts both. |
| [S7](S7.ts) | A long Shift hold restores the original and release recuts. A short tap leaves the cuts in place. A visible kept sentence moves at most 1 px through Shift and toggle cycles. |
| [S8](S8.ts) | A marker opens exactly its run at the marker's position. The run stays expanded after a lens toggle. Saves dark Wang before and after expansion. |
| [S9](S9.ts) | The bridge logs one `shown` and one `restore` per expanded sentence. Events queued during a bridge outage reach the restarted bridge. |
| [S10](S10.ts) | Replay replaces the Wang cell five times. Signed-in X must remove it through real scrolling and bring it back. Cuts and the expanded run return within 200 ms with zero new requests. Toggle, second-status navigation, and Back produce zero React DOM errors. A logged-out run uses replay for this row. |
| [S11](S11.ts) | A second status shows zero stale markers. Back recuts Wang from cache within 1 s. Replay and signed-in X navigate in the same document. |
| [S12](S12.ts) | A short X post and an unenabled Anthropic page show no changes or bridge requests. |
| [S12-page-mode](S12-page-mode.ts) | The popup switch cuts the Anthropic article in page mode with the shared lens off. A focused editor blocks activation. Lens off restores its prose HTML apart from IDs Anthropic regenerates during hydration. A section link retains the cut and a new hash route or reload ends page mode. |
| [S12-added-site](S12-added-site.ts) | Adding Anthropic cuts the open page and its reload. Removing access restores the original and clears the grant, script registration, and badge. The popup checkbox follows the active site and removal works from the Runs on list in another tab. |
| [S12-page-check](S12-page-check.ts) | Added GitHub skips the Firecrawl README and caches the verdict. The GitHub profile sends zero selection requests. Added Anthropic still cuts the checked article. |
| [S13](S13.ts) | The badge reports pending picks, the removed sentence count, a lower count after expansion, a failure, and an empty count for an untouched page. A press after failure shows a toast. |
| [S14](S14.ts) | The lens and Shift keys leave typing in Warp's newsletter field alone. |
| [S15](S15.ts) | A kept Warp link follows its normal destination without expanding a run or removing a mark. |
| [S16](S16.ts) | Warp cuts from cache within 1 s of its text entering the DOM. |
| [S17](S17.ts) | Wang has visible yellow tint on kept sentences. Holding Shift clears it. A click clears exactly one mark and logs one unmark. Short Perfloop stays untouched. |
| [S18](S18.ts) | Warp shows cuts and yellow marks together. Lens off clears the tint. Saves the cut page. |
| [S19](S19.ts) | Page mode cuts the bare-text essays Jessica and Great Work. Both reflow without added blank gaps, keep their marks, expand one run, and restore the exact original text and HTML. Saves each cut page. |
| [S20](S20.ts) | The page-key fallback and popup switch on X home show the open-post hint, keep the shared lens unchanged, and send zero selection requests. A short post shows the plain toast. The popup checkbox adds and removes a routed site. After an extension reload, the switch restarts the open tab with the lens on. Saves the X home toast and light and dark popup screenshots for a cut article, X home, an unenabled site, and a Chrome internal page. |
| [S21](S21.ts) | Reload the same unpacked install after copying the new build over 0.2.0. The service worker reports the original shortcut under `toggle-lens` and saves both command lists. |

S12 and its variants and S19 use fresh logged-out profiles in every suite. S20 uses replay and S21 uses an isolated upgrade profile. The logged-in suite also runs Warp-only rows in a fresh profile. S10 uses replay in the logged-out suite.

On the tested Chromium build, S21 fails because the 0.2.0 install's ⌥⇧F assignment is empty for both commands after reload. The popup offers **Set a shortcut** on the updated install.

## What the checks observe

- The DOM exposes the text and layout the reader sees. Snapshots cover the restored document. Screenshots check title and byline pixels and the yellow tint.
- The existing `data-filler-cut-state` and `data-filler-cut-faded` attributes report the view and removed count. A marked-only article still reports `faded`. S13 reads the actual toolbar badge through the service worker.
- The bridge's original `shown`, `restore`, and `unmark` event formats still apply. Check `events.jsonl` for clicks and `requests.jsonl` for cache hits and Pi calls.
- Playwright sends the page shortcut. The popup checks use Chromium's `Extensions.triggerAction` to open the native popup. Site checks pre-approve the prompt in Chrome, then request the grant from the popup. A physical browser shortcut requires native input.

## Why S10 uses two X modes

Public X uses paragraphs inside `[data-article-body-html]`. Signed-in X uses Draft blocks inside `[data-testid=twitterArticleRichTextView]` and virtualizes its timeline cells. Replay uses captured signed-in markup and replaces the article with fresh nodes. The signed-in run exercises real React updates and checks the page console for DOM errors.

The reference pages are the [Wang X Article](https://x.com/alexandr_wang/status/2124636606959345776), [Perfloop X post](https://x.com/tsenart/status/2123483102936785334), [Warp article](https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude), [Jessica Livingston](https://paulgraham.com/jessica.html), and [How to Do Great Work](https://paulgraham.com/greatwork.html).
