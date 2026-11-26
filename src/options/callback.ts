if (window.top !== window) throw new Error("Sign-in requires a browser tab");

const query = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const settings = chrome.runtime.getURL("options.html");
void chrome.runtime.sendMessage({ type: "chatgpt-callback", query }).then((response) => {
  if (!response || response.error) throw new Error();
  location.replace(settings);
}).catch(() => {
  document.querySelector("[role=status]")!.textContent = "ChatGPT sign-in could not be completed. Try again in settings.";
  const back = document.querySelector<HTMLAnchorElement>("#return")!;
  back.href = settings;
  back.hidden = false;
});
