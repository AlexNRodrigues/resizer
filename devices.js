(() => {
  const PRESETS = [
    { id: "compact", name: "Compacto", group: "Telefone", width: 320, height: 568 },
    { id: "galaxy-s8", name: "Galaxy S8+", group: "Telefone", width: 360, height: 740 },
    { id: "iphone-se", name: "iPhone SE", group: "Telefone", width: 375, height: 667 },
    { id: "iphone-14", name: "iPhone 14", group: "Telefone", width: 390, height: 844 },
    { id: "iphone-14-pro", name: "iPhone 14 Pro", group: "Telefone", width: 393, height: 852 },
    { id: "iphone-16-pro", name: "iPhone 16 Pro", group: "Telefone", width: 402, height: 874 },
    { id: "pixel-7", name: "Pixel 7", group: "Telefone", width: 412, height: 915 },
    { id: "iphone-14-pm", name: "iPhone 14 Pro Max", group: "Telefone", width: 430, height: 932 },
    { id: "iphone-16-pm", name: "iPhone 16 Pro Max", group: "Telefone", width: 440, height: 956 },
    { id: "ipad-mini", name: "iPad Mini", group: "Tablet", width: 768, height: 1024 },
    { id: "ipad-air", name: "iPad Air", group: "Tablet", width: 820, height: 1180 },
    { id: "ipad-pro-11", name: "iPad Pro 11\"", group: "Tablet", width: 834, height: 1194 },
    { id: "ipad-pro-129", name: "iPad Pro 12.9\"", group: "Tablet", width: 1024, height: 1366 },
    { id: "laptop", name: "Notebook", group: "Computador", width: 1280, height: 800 },
    { id: "laptop-hd", name: "Notebook HD", group: "Computador", width: 1366, height: 768 },
    { id: "desktop", name: "Desktop", group: "Computador", width: 1440, height: 900 },
    { id: "full-hd", name: "Full HD", group: "Computador", width: 1920, height: 1080 },
  ];

  const GROUPS = ["Telefone", "Tablet", "Computador"];
  const DEFAULT_IDS = ["iphone-14", "ipad-air", "laptop"];
  const MAX_DEVICES = 8;

  globalThis.ResizerDevices = {
    PRESETS,
    GROUPS,
    DEFAULT_IDS,
    MAX_DEVICES,
  };
})();
