(() => {
  if (window.__resizerFrameSync) return;
  if (!window.name || !window.name.startsWith("rz:")) return;
  window.__resizerFrameSync = true;

  const CHANNEL = "__resizer_sync_v1";
  const id = window.name.slice(3);
  let silence = 0;
  let lastUrl = "";
  let scrollScheduled = false;

  function post(payload) {
    chrome.runtime.sendMessage({
      channel: CHANNEL,
      id,
      token: Math.round(performance.timeOrigin),
      ...payload,
    }).catch(() => {});
  }

  function reportUrl() {
    const url = location.href;
    if (!/^https?:/i.test(url) || url === lastUrl) return;
    lastUrl = url;
    post({ type: "url", url });
  }

  function reportScroll() {
    if (silence || scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      if (silence) return;
      const root = document.scrollingElement || document.documentElement;
      const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
      const maxX = Math.max(0, root.scrollWidth - window.innerWidth);
      post({
        type: "scroll",
        x: maxX ? window.scrollX / maxX : 0,
        y: maxY ? window.scrollY / maxY : 0,
      });
    });
  }

  function claim() {
    post({ type: "leader" });
  }

  window.addEventListener("pageshow", reportUrl);
  window.addEventListener("popstate", reportUrl);
  window.addEventListener("hashchange", reportUrl);
  window.addEventListener("scroll", reportScroll, { passive: true });
  window.addEventListener("pointerdown", claim, true);
  window.addEventListener("keydown", claim, true);
  window.addEventListener("wheel", claim, { capture: true, passive: true });
  setInterval(reportUrl, 300);
  reportUrl();

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL || event.source !== window.parent) return;

    if (data.type === "reload") {
      location.reload();
      return;
    }

    if (data.type !== "scroll-to") return;
    const root = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
    const maxX = Math.max(0, root.scrollWidth - window.innerWidth);
    silence += 1;
    window.scrollTo(maxX * clampRatio(data.x), maxY * clampRatio(data.y));
    setTimeout(() => {
      silence = Math.max(0, silence - 1);
    }, 120);
  });

  function clampRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(0, number));
  }
})();
