const quietMs = 12;
const maxWaitMs = 80;

export function observePage(scan: () => void, navigate: () => void, onMutations: (records: MutationRecord[]) => void) {
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

  function changed(records: MutationRecord[]) {
    if (!records.length) return;
    onMutations(records);
    const now = performance.now();
    firstMutation ??= now;
    clearTimeout(timer);
    timer = setTimeout(() => {
      firstMutation = undefined;
      if (!urlChanged()) scan();
    }, Math.max(0, Math.min(quietMs, maxWaitMs - (now - firstMutation))));
  }

  const observer = new MutationObserver((records) => {
    changed(records);
    urlChanged();
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["hidden", "aria-hidden", "class", "contenteditable"],
  });

  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (navigation) navigation.addEventListener("currententrychange", urlChanged);
  else window.setInterval(urlChanged, 50);

  return (project: () => void) => {
    // Keep pending site mutations and discard records from the synchronous projection.
    changed(observer.takeRecords());
    try { project(); } finally { observer.takeRecords(); }
  };
}
