const quietMs = 12;
const maxWaitMs = 80;

export function observePage(scan: () => void, navigate: () => void) {
  let firstMutation: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let href = location.href;

  function urlChanged() {
    if (href === location.href) return false;
    href = location.href;
    clearTimeout(timer);
    firstMutation = undefined;
    navigate();
    return true;
  }

  new MutationObserver(() => {
    if (urlChanged()) return;
    const now = performance.now();
    firstMutation ??= now;
    clearTimeout(timer);
    timer = setTimeout(() => {
      firstMutation = undefined;
      if (!urlChanged()) scan();
    }, Math.max(0, Math.min(quietMs, maxWaitMs - (now - firstMutation))));
  }).observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["hidden", "aria-hidden", "class"],
  });

  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (navigation) navigation.addEventListener("currententrychange", urlChanged);
  else window.setInterval(urlChanged, 50);
}
