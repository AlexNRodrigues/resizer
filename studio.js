(() => {
  if (globalThis.__resizerApi) {
    globalThis.__resizerApi.close();
    return;
  }
  if (globalThis.__resizerStarting) return;
  globalThis.__resizerStarting = true;

  const CHANNEL = "__resizer_sync_v1";
  const catalog = globalThis.ResizerDevices;
  const isViewer = location.protocol === "chrome-extension:" && location.pathname.endsWith("/viewer.html");

  const state = {
    url: "",
    devices: [],
    custom: [],
    navSync: true,
    scrollSync: true,
    fit: true,
    scale: 1,
    viewScale: 1,
    leader: null,
    dragging: false,
  };

  const frames = new Map();
  let persistTimer = 0;
  let ui = null;
  let shadow = null;
  let host = null;

  start().catch((error) => {
    globalThis.__resizerStarting = false;
    console.warn("Resizer: falha ao iniciar.", error);
    showFatal();
  });

  async function start() {
    const initial = isViewer ? new URLSearchParams(location.search).get("url") || "" : location.href;
    state.url = safeHttpUrl(initial) || "";

    if (!isViewer && !document.body) {
      throw new Error("sem body");
    }

    const stored = await chrome.storage.local.get({
      activeIds: catalog.DEFAULT_IDS,
      sizes: {},
      custom: [],
      navSync: true,
      scrollSync: true,
      fit: true,
      scale: 1,
    });

    state.custom = Array.isArray(stored.custom) ? stored.custom.filter(isDevice) : [];
    state.navSync = stored.navSync !== false;
    state.scrollSync = stored.scrollSync !== false;
    state.fit = stored.fit !== false;
    state.scale = clamp(Number(stored.scale) || 1, 0.15, 1);

    const ids = Array.isArray(stored.activeIds) && stored.activeIds.length ? stored.activeIds : catalog.DEFAULT_IDS;
    state.devices = ids
      .map((id) => resolveDevice(id, stored.sizes || {}))
      .filter(Boolean)
      .slice(0, catalog.MAX_DEVICES);

    const watched = await chrome.runtime.sendMessage({
      type: "watch-tab",
      mode: isViewer ? "viewer" : "page",
    });
    state.tabId = watched?.tabId || null;

    await mount();
    reconcile(false);
    setTitle();
    globalThis.__resizerStarting = false;
    globalThis.__resizerApi = { close };
  }

  async function mount() {
    const css = await fetch(chrome.runtime.getURL("studio.css")).then((response) => {
      if (!response.ok) throw new Error("css");
      return response.text();
    });

    host = document.createElement("div");
    host.id = "resizer-root";
    host.style.cssText = "all:initial;display:block;position:fixed;inset:0;z-index:2147483647;background:#101114;color-scheme:dark;";
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch (error) {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.append(style);
    }

    const app = el("div", "app");
    const bar = el("div", "bar");
    const brand = el("div", "brand");
    brand.append(el("span", "mark"), text("span", "Resizer"));

    const address = document.createElement("input");
    address.className = "address";
    address.type = "text";
    address.spellcheck = false;
    address.autocomplete = "off";
    address.placeholder = "https://localhost:3000";
    address.value = state.url;
    address.setAttribute("aria-label", "Endereço");
    address.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        go(address.value);
      }
    });

    const tools = el("div", "tools");
    const reload = button({ title: "Recarregar todas", iconName: "reload", className: "icon-btn", onClick: reloadAll });
    const nav = button({
      label: "Navegação",
      title: "A página aberta na tela ativa também abre nas outras",
      className: "btn",
      pressed: state.navSync,
      onClick: () => {
        state.navSync = !state.navSync;
        nav.setAttribute("aria-pressed", String(state.navSync));
        persistSoon();
      },
    });
    const scroll = button({
      label: "Rolagem",
      title: "A rolagem da tela ativa acompanha nas outras",
      className: "btn",
      pressed: state.scrollSync,
      onClick: () => {
        state.scrollSync = !state.scrollSync;
        scroll.setAttribute("aria-pressed", String(state.scrollSync));
        persistSoon();
      },
    });
    const fit = button({
      label: "Ajustar",
      title: "Encaixa a tela mais alta na janela. A escala não muda as media queries.",
      className: "btn",
      pressed: state.fit,
      onClick: () => {
        state.fit = !state.fit;
        fit.setAttribute("aria-pressed", String(state.fit));
        layout();
        persistSoon();
      },
    });

    const scaleWrap = el("label", "scale");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "15";
    slider.max = "100";
    slider.value = String(Math.round(state.scale * 100));
    slider.setAttribute("aria-label", "Escala visual");
    slider.title = "A escala só muda o tamanho visual. As media queries usam a largura real do dispositivo.";
    const percent = text("span", slider.value + "%");
    slider.addEventListener("input", () => {
      state.fit = false;
      state.scale = Number(slider.value) / 100;
      fit.setAttribute("aria-pressed", "false");
      layout();
      persistSoon();
    });
    scaleWrap.append(slider, percent);

    const menuWrap = el("div", "menu-wrap");
    const devicesBtn = button({
      label: "Dispositivos",
      title: "Escolher tamanhos",
      className: "btn",
      onClick: () => {
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        devicesBtn.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) paintMenu();
      },
    });
    devicesBtn.setAttribute("aria-expanded", "false");
    devicesBtn.setAttribute("aria-haspopup", "true");
    const menu = el("div", "menu");
    menu.hidden = true;
    menuWrap.append(devicesBtn, menu);

    const close = button({
      label: isViewer ? "Voltar" : "Fechar",
      title: isViewer ? "Voltar para a página" : "Fechar e recarregar a página",
      className: "btn",
      onClick: () => globalThis.__resizerApi.close(),
    });

    tools.append(reload, nav, scroll, fit, scaleWrap, menuWrap, close);
    bar.append(brand, address, tools);

    const stage = el("div", "stage");
    app.append(bar, stage);
    shadow.append(app);

    ui = { app, address, nav, scroll, fit, slider, percent, menu, devicesBtn, stage };

    shadow.addEventListener("pointerdown", (event) => {
      if (menu.hidden) return;
      const path = event.composedPath();
      if (path.includes(menu) || path.includes(devicesBtn)) return;
      menu.hidden = true;
      devicesBtn.setAttribute("aria-expanded", "false");
    });

    window.addEventListener("keydown", onKey);
    chrome.runtime.onMessage.addListener(onFrameMessage);
    window.addEventListener("resize", layout);
    new ResizeObserver(() => layout()).observe(stage);

    if (!isViewer) {
      const observer = new MutationObserver(() => {
        if (host && document.body && !document.body.contains(host)) {
          document.body.appendChild(host);
        }
      });
      if (document.body) observer.observe(document.body, { childList: true });
      ui.observer = observer;
    }
  }

  function paintMenu() {
    ui.menu.replaceChildren();
    if (state.devices.length >= catalog.MAX_DEVICES) {
      ui.menu.append(text("div", "Limite de 8 telas para o teste continuar leve.", "hint"));
    }

    for (const group of catalog.GROUPS) {
      const items = catalog.PRESETS.filter((device) => device.group === group);
      ui.menu.append(text("div", group, "group-label"));
      for (const preset of items) ui.menu.append(menuRow(preset));
    }

    if (state.custom.length) {
      ui.menu.append(text("div", "Meus tamanhos", "group-label"));
      for (const preset of state.custom) ui.menu.append(menuRow(preset, true));
    }

    const form = document.createElement("form");
    form.className = "custom";
    const name = field("Nome", "text");
    name.classList.add("wide");
    name.placeholder = "Nome";
    const width = field("Largura", "number");
    width.placeholder = "Largura";
    width.min = "200";
    width.max = "3840";
    const height = field("Altura", "number");
    height.placeholder = "Altura";
    height.min = "200";
    height.max = "3840";
    const add = button({ label: "Adicionar tamanho", className: "btn wide", onClick: () => {} });
    add.type = "submit";
    form.append(name, width, height, add);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addCustom(name.value, width.value, height.value);
    });
    ui.menu.append(form);

    const compat = document.createElement("button");
    compat.type = "button";
    compat.className = "menu-link";
    compat.textContent = "Modo compatível";
    compat.title = "Abre um visualizador separado e ignora bloqueio de iframe. O login da página pode não aparecer.";
    compat.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "open-viewer", url: state.url });
    });
    if (!isViewer) ui.menu.append(compat);
  }

  function menuRow(preset, custom) {
    const live = state.devices.find((device) => device.id === preset.id);
    const active = Boolean(live);
    const shownW = live ? live.width : preset.width;
    const shownH = live ? live.height : preset.height;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "menu-item";
    row.setAttribute("aria-pressed", String(active));

    const left = el("span");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";
    const tick = text("span", active ? "●" : "", "tick");
    const label = text("span", preset.name);
    left.append(tick, label);

    const meta = text("span", shownW + "×" + shownH, "meta");
    row.append(left, meta);
    row.addEventListener("click", () => toggleDevice(preset));

    if (custom) {
      const remove = document.createElement("span");
      remove.className = "remove-custom";
      remove.textContent = "×";
      remove.title = "Apagar tamanho";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        state.custom = state.custom.filter((device) => device.id !== preset.id);
        state.devices = state.devices.filter((device) => device.id !== preset.id);
        reconcile(false);
        paintMenu();
      });
      row.append(remove);
    }

    return row;
  }

  function toggleDevice(preset) {
    const index = state.devices.findIndex((device) => device.id === preset.id);
    if (index >= 0) {
      state.devices.splice(index, 1);
      if (state.leader === preset.id) state.leader = null;
    } else if (state.devices.length < catalog.MAX_DEVICES) {
      state.devices.push(deviceFrom(preset));
    }
    reconcile(index < 0);
    paintMenu();
    paintLeader();
  }

  function addCustom(name, widthValue, heightValue) {
    const width = clampSize(widthValue);
    const height = clampSize(heightValue);
    if (!width || !height) return;
    const device = {
      id: "c" + Date.now().toString(36),
      name: name.trim() || width + " × " + height,
      group: "custom",
      width,
      height,
    };
    state.custom.push(device);
    if (state.devices.length < catalog.MAX_DEVICES) state.devices.push({ ...device });
    reconcile(true);
    paintMenu();
  }

  function reconcile(scrollNew) {
    const ids = new Set(state.devices.map((device) => device.id));
    for (const [id, frame] of frames) {
      if (!ids.has(id)) {
        if (frame.poll) clearInterval(frame.poll);
        frame.el.remove();
        frames.delete(id);
      }
    }

    let created = null;
    for (const device of state.devices) {
      let frame = frames.get(device.id);
      if (!frame) {
        frame = createFrame(device);
        frames.set(device.id, frame);
        created = frame;
      }
      frame.name.textContent = device.name;
      frame.size.textContent = device.width + " × " + device.height;
      ui.stage.appendChild(frame.el);
    }

    ui.stage.querySelector("[data-empty]")?.remove();
    if (!state.devices.length) {
      const empty = text("div", "Nenhum dispositivo selecionado.", "empty");
      empty.dataset.empty = "true";
      ui.stage.appendChild(empty);
    }

    layout();
    persistSoon();
    if (scrollNew && created) created.el.scrollIntoView({ inline: "end", block: "nearest", behavior: "smooth" });
  }

  function createFrame(device) {
    const root = el("article", "device");
    root.dataset.id = device.id;

    const head = el("div", "head");
    const name = text("span", device.name, "name");
    const size = text("span", "", "size");
    const spacer = el("span", "spacer");
    const rotate = mini("rotate", "Girar", () => rotateDevice(device.id));
    const remove = mini("close", "Remover", () => {
      state.devices = state.devices.filter((item) => item.id !== device.id);
      if (state.leader === device.id) state.leader = null;
      reconcile(false);
      paintLeader();
    });
    head.append(name, size, spacer, rotate, remove);

    const screen = el("div", "screen");
    const scaler = el("div", "scaler");
    const iframe = document.createElement("iframe");
    iframe.name = "rz:" + device.id;
    iframe.setAttribute("name", iframe.name);
    iframe.title = device.name;
    iframe.setAttribute("loading", "eager");
    const url = state.url;
    const frame = {
      id: device.id,
      el: root,
      name,
      size,
      screen,
      scaler,
      iframe,
      href: url,
      pending: url,
      token: 0,
      poll: 0,
    };
    iframe.addEventListener("pointerdown", () => {
      state.leader = frame.id;
      paintLeader();
    });
    iframe.addEventListener("load", () => {
      bindSameOrigin(frame);
      chrome.runtime.sendMessage({ type: "inject-frames" }).catch(() => {});
    });
    if (url) {
      iframe.src = url;
      screen.classList.add("is-loading");
    }
    scaler.append(iframe);
    screen.append(scaler);

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "handle";
    handle.title = "Arrastar para mudar a largura e a altura";
    handle.setAttribute("aria-label", "Redimensionar " + device.name);
    handle.addEventListener("pointerdown", (event) => startResize(event, device.id, handle));
    screen.append(handle);

    root.append(head, screen);
    root.addEventListener("pointerdown", () => {
      state.leader = device.id;
      paintLeader();
    });

    return frame;
  }

  function bindSameOrigin(frame) {
    if (!frame) return;
    let win;
    try {
      win = frame.iframe.contentWindow;
      if (!win || !/^https?:/i.test(win.location.href)) return;
    } catch {
      return;
    }
    if (frame.boundWindow === win) return;
    frame.boundWindow = win;
    if (frame.poll) clearInterval(frame.poll);

    const report = () => {
      try {
        onUrl(frame, {
          url: win.location.href,
          token: Math.round(win.performance.timeOrigin),
        });
        publishScroll(frame);
      } catch {
        clearInterval(frame.poll);
      }
    };
    const onScroll = () => publishScroll(frame);
    win.addEventListener("pointerdown", () => {
      state.leader = frame.id;
      paintLeader();
    }, true);
    win.addEventListener("scroll", onScroll, { passive: true });
    win.document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    frame.poll = setInterval(report, 200);
    report();
  }

  function readRatio(frame) {
    const win = frame.iframe.contentWindow;
    const root = win.document.scrollingElement || win.document.documentElement;
    const maxX = Math.max(0, root.scrollWidth - win.innerWidth);
    const maxY = Math.max(0, root.scrollHeight - win.innerHeight);
    return {
      x: maxX ? win.scrollX / maxX : 0,
      y: maxY ? win.scrollY / maxY : 0,
    };
  }

  function publishScroll(frame) {
    if (!state.scrollSync) return;
    let pos;
    try {
      pos = readRatio(frame);
    } catch {
      return;
    }
    const prev = frame.ratio || { x: 0, y: 0 };
    const moved = Math.abs(prev.x - pos.x) > 0.004 || Math.abs(prev.y - pos.y) > 0.004;
    frame.ratio = pos;
    if (!moved || frame.silentScroll) return;
    state.leader = frame.id;
    paintLeader();
    for (const other of frames.values()) {
      if (other.id === frame.id) continue;
      other.silentScroll = true;
      other.ratio = pos;
      scrollFrame(other, pos.x, pos.y);
      setTimeout(() => {
        other.silentScroll = false;
      }, 500);
    }
  }

  function scrollFrame(frame, x, y) {
    try {
      const win = frame.iframe.contentWindow;
      const root = win.document.scrollingElement || win.document.documentElement;
      const maxX = Math.max(0, root.scrollWidth - win.innerWidth);
      const maxY = Math.max(0, root.scrollHeight - win.innerHeight);
      win.scrollTo(maxX * x, maxY * y);
    } catch {
      post(frame, { type: "scroll-to", x, y });
    }
  }

  function startResize(event, id, handle) {
    const device = state.devices.find((item) => item.id === id);
    if (!device) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = device.width;
    const startH = device.height;
    state.dragging = true;
    ui.app.classList.add("is-dragging");

    function move(ev) {
      const scale = state.viewScale || 1;
      device.width = clampSize(Math.round(startW + (ev.clientX - startX) / scale));
      device.height = clampSize(Math.round(startH + (ev.clientY - startY) / scale));
      layout();
    }

    function end() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      state.dragging = false;
      ui.app.classList.remove("is-dragging");
      layout();
      persistSoon();
    }

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
  }

  function rotateDevice(id) {
    const device = state.devices.find((item) => item.id === id);
    if (!device) return;
    const width = device.width;
    device.width = device.height;
    device.height = width;
    layout();
    persistSoon();
  }

  function layout() {
    if (!ui) return;
    const scale = computeScale();
    state.viewScale = scale;
    ui.percent.textContent = Math.round(scale * 100) + "%";
    if (state.fit && shadow.activeElement !== ui.slider) {
      ui.slider.value = String(Math.round(scale * 100));
    }

    for (const device of state.devices) {
      const frame = frames.get(device.id);
      if (!frame) continue;
      const visualW = Math.round(device.width * scale);
      const visualH = Math.round(device.height * scale);
      frame.el.style.width = Math.max(visualW, 180) + "px";
      frame.screen.style.width = visualW + "px";
      frame.screen.style.height = visualH + "px";
      frame.scaler.style.width = device.width + "px";
      frame.scaler.style.height = device.height + "px";
      frame.scaler.style.transform = "scale(" + scale + ")";
      frame.iframe.style.width = device.width + "px";
      frame.iframe.style.height = device.height + "px";
      frame.size.textContent = device.width + " × " + device.height;
    }
  }

  function computeScale() {
    if (!state.devices.length) return 1;
    if (!state.fit || state.dragging) return clamp(state.dragging ? state.viewScale || state.scale : state.scale, 0.15, 1);
    const maxH = Math.max(...state.devices.map((device) => device.height));
    const style = getComputedStyle(ui.stage);
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const avail = ui.stage.clientHeight - pad - 36;
    if (avail <= 0) return 0.5;
    return clamp(avail / maxH, 0.15, 1);
  }

  function onFrameMessage(data, sender) {
    if (!data || data.channel !== CHANNEL || !data.id) return;
    if (state.tabId && sender?.tab?.id !== state.tabId) return;
    const frame = frames.get(data.id);
    if (!frame) return;

    if (data.type === "leader") {
      state.leader = frame.id;
      paintLeader();
      return;
    }

    if (data.type === "scroll") {
      if (!state.scrollSync || state.leader !== frame.id) return;
      for (const other of frames.values()) {
        if (other.id === frame.id) continue;
        post(other, { type: "scroll-to", x: data.x, y: data.y });
      }
      return;
    }

    if (data.type === "url") onUrl(frame, data);
  }

  function onUrl(frame, message) {
    const url = safeHttpUrl(message.url);
    if (!url) return;
    const token = Number(message.token) || 0;

    if (frame.pending) {
      if (token <= frame.token) return;
      const redirected = url !== frame.pending;
      frame.token = token;
      frame.pending = "";
      frame.href = url;
      frame.screen.classList.remove("is-loading");
      if (redirected && shouldSync(frame)) applyUrl(url, frame.id);
      return;
    }

    if (token < frame.token) return;
    if (token === frame.token && url === frame.href) return;
    frame.token = token;
    frame.href = url;
    frame.screen.classList.remove("is-loading");
    if (shouldSync(frame)) applyUrl(url, frame.id);
  }

  function shouldSync(frame) {
    return state.navSync && (!state.leader || state.leader === frame.id);
  }

  function applyUrl(url, sourceId) {
    const safe = safeHttpUrl(url);
    if (!safe) return;
    state.url = safe;
    setTitle();
    if (shadow.activeElement !== ui.address) ui.address.value = safe;
    for (const frame of frames.values()) {
      if (frame.id === sourceId) continue;
      assign(frame, safe);
    }
  }

  function assign(frame, url) {
    if ((frame.href === url && !frame.pending) || frame.pending === url) return;
    frame.pending = url;
    frame.href = url;
    frame.screen.classList.add("is-loading");
    frame.iframe.src = url;
  }

  function go(value) {
    const url = normalizeUrl(value);
    if (!url) return;
    state.url = url;
    state.leader = null;
    paintLeader();
    setTitle();
    ui.address.value = url;
    for (const frame of frames.values()) assign(frame, url);
  }

  function reloadAll() {
    for (const frame of frames.values()) {
      const url = frame.href || state.url;
      if (!url) continue;
      frame.pending = url;
      frame.screen.classList.add("is-loading");
      try {
        frame.iframe.contentWindow.location.reload();
      } catch (error) {
        post(frame, { type: "reload" });
      }
    }
  }

  function post(frame, payload) {
    frame.iframe.contentWindow?.postMessage({ channel: CHANNEL, ...payload }, "*");
  }

  function paintLeader() {
    for (const frame of frames.values()) {
      frame.el.classList.toggle("is-leader", frame.id === state.leader);
    }
  }

  function onKey(event) {
    if (event.key !== "Escape" || !ui || ui.menu.hidden) return;
    ui.menu.hidden = true;
    ui.devicesBtn.setAttribute("aria-expanded", "false");
  }

  function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 120);
  }

  function persist() {
    const sizes = {};
    for (const device of state.devices) {
      sizes[device.id] = { width: device.width, height: device.height };
    }
    for (const device of state.custom) {
      const live = state.devices.find((item) => item.id === device.id);
      if (live) {
        device.width = live.width;
        device.height = live.height;
      }
    }
    chrome.storage.local.set({
      activeIds: state.devices.map((device) => device.id),
      sizes,
      custom: state.custom,
      navSync: state.navSync,
      scrollSync: state.scrollSync,
      fit: state.fit,
      scale: state.fit ? state.viewScale : state.scale,
    });
  }

  async function close() {
    window.removeEventListener("keydown", onKey);
    chrome.runtime.onMessage.removeListener(onFrameMessage);
    window.removeEventListener("resize", layout);
    ui?.observer?.disconnect();
    globalThis.__resizerApi = null;
    globalThis.__resizerStarting = false;
    try {
      await chrome.runtime.sendMessage({ type: "unwatch-tab" });
    } catch (error) {
      // The tab can close before the worker answers.
    }
    if (isViewer) {
      if (state.url) location.href = state.url;
      else window.close();
      return;
    }
    location.reload();
  }

  function setTitle() {
    try {
      const hostName = state.url ? new URL(state.url).host : "";
      document.title = hostName ? "Resizer — " + hostName : "Resizer";
    } catch (error) {
      document.title = "Resizer";
    }
  }

  function resolveDevice(id, sizes) {
    const preset = catalog.PRESETS.find((device) => device.id === id) || state.custom.find((device) => device.id === id);
    if (!preset) return null;
    const saved = sizes[id] || {};
    return {
      id: preset.id,
      name: preset.name,
      width: clampSize(saved.width || preset.width),
      height: clampSize(saved.height || preset.height),
    };
  }

  function deviceFrom(preset) {
    return resolveDevice(preset.id, {}) || {
      id: preset.id,
      name: preset.name,
      width: preset.width,
      height: preset.height,
    };
  }

  function isDevice(value) {
    return value && typeof value.id === "string" && typeof value.name === "string" && clampSize(value.width) && clampSize(value.height);
  }

  function button({ label, title, iconName, className, pressed, onClick }) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className || "btn";
    if (title) {
      node.title = title;
      node.setAttribute("aria-label", title);
    }
    if (pressed != null) node.setAttribute("aria-pressed", String(pressed));
    if (iconName) node.append(icon(iconName));
    if (label) node.append(text("span", label));
    node.addEventListener("click", onClick);
    return node;
  }

  function mini(iconName, title, onClick) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "mini";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.append(icon(iconName));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return node;
  }

  function field(label, type) {
    const input = document.createElement("input");
    input.type = type;
    input.setAttribute("aria-label", label);
    return input;
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function text(tag, value, className) {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  }

  function icon(name) {
    const wrap = el("span", "icon");
    wrap.innerHTML = ICONS[name] || "";
    return wrap;
  }

  function normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return safeHttpUrl(raw);
    if (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(raw)) return safeHttpUrl("http://" + raw);
    return safeHttpUrl("https://" + raw);
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

  function clampSize(value) {
    if (value === "" || value == null) return 0;
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return 0;
    return Math.min(3840, Math.max(200, number));
  }

  function showFatal() {
    const board = document.createElement("div");
    board.textContent = "O Resizer não abriu. Recarregue a página e tente de novo.";
    board.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#101114;color:#eceef2;font:15px/1.5 Segoe UI,sans-serif;text-align:center;";
    (document.body || document.documentElement).appendChild(board);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  const ICONS = {
    reload:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.6"/><path d="M13.2 2.8V6H10"/></svg>',
    rotate:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.6"/><path d="M2.8 2.8V6H6"/></svg>',
    close:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  };
})();
