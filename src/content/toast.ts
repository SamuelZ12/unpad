import { statusFeedback } from "../shared/status-copy";

export function createToast(mutate: (change: () => void) => void) {
  let dismiss: (() => void) | undefined;
  return (message?: ReturnType<typeof statusFeedback>) => {
    dismiss?.();
    if (!message) return;
    const host = document.createElement("filler-cut-toast");
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial !important; display: contents !important; }
      div {
        color-scheme: light dark;
        position: fixed;
        inset: auto auto 24px 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        box-sizing: border-box;
        max-width: calc(100vw - 32px);
        width: max-content;
        padding: 10px 17px;
        border: 1px solid light-dark(#deddd8, #44433e);
        border-radius: 20px;
        background: light-dark(#fff, #242423);
        color: light-dark(#242423, #f3f2ef);
        box-shadow: 0 3px 14px #0002;
        font: 600 13px/1.4 system-ui, sans-serif;
        text-align: center;
        pointer-events: none;
        overflow-wrap: anywhere;
        transition: opacity 160ms ease;
      }
      span { display: block; font-weight: 400; }
      .dismissed { opacity: 0; }
      @media (prefers-reduced-motion: reduce) { div { transition: none; } }
    `);
    shadow.adoptedStyleSheets = [sheet];
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    shadow.append(box);
    mutate(() => document.documentElement.append(host));
    const detach = () => mutate(() => host.remove());
    requestAnimationFrame(() => {
      box.textContent = message.title;
      if (message.detail) {
        const detail = document.createElement("span");
        detail.textContent = message.detail;
        box.append(detail);
      }
    });
    const fade = setTimeout(() => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) detach();
      else box.classList.add("dismissed");
    }, 2000);
    const remove = setTimeout(detach, 2160);
    dismiss = () => {
      clearTimeout(fade);
      clearTimeout(remove);
      detach();
      dismiss = undefined;
    };
  };
}
