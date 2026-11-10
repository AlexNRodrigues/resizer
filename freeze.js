(() => {
  if (window.__resizerFrozen) return;
  window.__resizerFrozen = true;

  try {
    window.stop();
  } catch (error) {
    // ignore
  }

  const block = () => 0;
  try {
    window.setTimeout = block;
    window.setInterval = block;
    window.requestAnimationFrame = block;
  } catch (error) {
    // ignore
  }

  try {
    window.fetch = () => new Promise(() => {});
  } catch (error) {
    // ignore
  }

  try {
    window.WebSocket = function WebSocketBlocked() {
      return {
        close() {},
        send() {},
        addEventListener() {},
        removeEventListener() {},
        readyState: 3,
      };
    };
  } catch (error) {
    // ignore
  }

  try {
    window.EventSource = function EventSourceBlocked() {
      return { close() {}, addEventListener() {}, removeEventListener() {} };
    };
  } catch (error) {
    // ignore
  }

  if (!document.body) return;

  const host = document.getElementById("resizer-root");
  document.body.replaceChildren();
  if (host) document.body.appendChild(host);
})();
