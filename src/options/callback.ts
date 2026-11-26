const query = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
void chrome.runtime.sendMessage({ type: "chatgpt-callback", query }).finally(() => {
  location.replace(chrome.runtime.getURL("options.html"));
});
