const SESSION_KEY = "resizerTabs";

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#d6f25c" });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ color: "#17190f" });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (tab.url && tab.url.startsWith(chrome.runtime.getURL("viewer.html"))) {
    return;
  }

  if (!tab.url || !/^https?:/i.test(tab.url)) {
    openViewer("");
    return;
  }

  try {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Boolean(globalThis.__resizerApi),
    });

    if (probe?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["studio.js"],
      });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["freeze.js"],
      world: "MAIN",
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["devices.js", "studio.js"],
    });
  } catch (error) {
    console.warn("Resizer: falha ao abrir na página, usando o visualizador.", error);
    try {
      await chrome.tabs.reload(tab.id);
    } catch (reloadError) {
      console.warn("Resizer: não recarregou a aba.", reloadError);
    }
    openViewer(tab.url || "");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!message || !tabId) return;

  if (message.type === "watch-tab") {
    watch(tabId, message.mode === "viewer" ? "viewer" : "page")
      .then(() => sendResponse({ ok: true, tabId }))
      .catch((error) => {
        console.warn("Resizer: falha ao observar a aba.", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "unwatch-tab") {
    unwatch(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "inject-frames") {
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["frame-sync.js"],
    }).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }

  if (message.type === "open-viewer") {
    openViewer(message.url || "");
    sendResponse({ ok: true });
  }
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0 || !/^https?:/i.test(details.url || "")) return;

  const tabs = await readTabs();
  if (!tabs[details.tabId]) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      files: ["frame-sync.js"],
      injectImmediately: true,
    });
  } catch (error) {
    // The frame can disappear before the script lands.
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  unwatch(tabId).catch(() => {});
});

function openViewer(url) {
  const page = new URL(chrome.runtime.getURL("viewer.html"));
  const safe = safeHttpUrl(url);
  if (safe) page.searchParams.set("url", safe);
  chrome.tabs.create({ url: page.href });
}

async function watch(tabId, mode) {
  const tabs = await readTabs();
  const previous = tabs[tabId];
  tabs[tabId] = { mode };
  await writeTabs(tabs);

  if (mode === "viewer" && previous?.mode !== "viewer") {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId(tabId)],
        addRules: [headerRule(tabId)],
      });
    } catch (error) {
      console.warn("Resizer: não removeu o bloqueio de iframe.", error);
    }
  }

  chrome.action.setBadgeText({ tabId, text: "ON" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d6f25c" });
  if (chrome.action.setBadgeTextColor) {
    chrome.action.setBadgeTextColor({ tabId, color: "#17190f" });
  }
}

async function unwatch(tabId) {
  const tabs = await readTabs();
  const previous = tabs[tabId];
  if (!previous) {
    clearBadge(tabId);
    return;
  }

  delete tabs[tabId];
  await writeTabs(tabs);
  clearBadge(tabId);

  if (previous.mode === "viewer") {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId(tabId)],
      });
    } catch (error) {
      // The rule may already be gone with the tab.
    }
  }
}

function clearBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
}

function ruleId(tabId) {
  return tabId;
}

function headerRule(tabId) {
  return {
    id: ruleId(tabId),
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        "x-frame-options",
        "content-security-policy",
        "content-security-policy-report-only",
      ].map((header) => ({ header, operation: "remove" })),
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: ["sub_frame"],
    },
  };
}

async function readTabs() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY] || {};
}

async function writeTabs(tabs) {
  await chrome.storage.session.set({ [SESSION_KEY]: tabs });
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch (error) {
    return "";
  }
  return "";
}
