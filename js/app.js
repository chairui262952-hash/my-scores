/* 我的谱架 — 应用入口 / 路由 / 全局设置（原创实现） */
"use strict";

var APP = (() => {
  const DEFAULTS = {
    theme: "dark",
    scrollSpeed: 60,
    brightness: 100,
    invert: false,
    keyNext: "ArrowRight",
    keyPrev: "ArrowLeft",
  };
  let settings = { ...DEFAULTS };

  async function loadSettings() {
    const saved = await DB.getKV("settings", null);
    if (saved) settings = { ...DEFAULTS, ...saved };
    applyTheme();
    // 同步设置页控件
    document.getElementById("set-theme").value = settings.theme;
    document.getElementById("set-speed").value = settings.scrollSpeed;
    document.getElementById("cap-next").textContent = keyLabel(settings.keyNext);
    document.getElementById("cap-prev").textContent = keyLabel(settings.keyPrev);
  }

  function saveSettings() {
    DB.setKV("settings", settings);
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
  }

  function keyLabel(k) {
    return k === " " ? "Space" : k;
  }

  // ---------- 键位捕获 ----------
  function bindCapture(btnId, prop) {
    const btn = document.getElementById(btnId);
    btn.addEventListener("click", () => {
      btn.textContent = "按下任意键…";
      btn.classList.add("capturing");
      const handler = e => {
        e.preventDefault();
        e.stopPropagation();
        let k = e.key === " " ? "Space" : e.key;
        settings[prop] = k;
        saveSettings();
        btn.textContent = keyLabel(k);
        btn.classList.remove("capturing");
        document.removeEventListener("keydown", handler, true);
      };
      document.addEventListener("keydown", handler, true);
    });
  }

  // ---------- 路由 ----------
  const screens = ["library", "setlists", "settings", "viewer"];
  let lastHash = null;
  function showScreen(name) {
    for (const s of screens) {
      const el = document.getElementById("screen-" + s);
      const show = s === name;
      if (show && el.hidden) {
        // 进入时播放过渡动画
        el.classList.remove("enter");
        void el.offsetWidth; // 强制 reflow 以重启动画
        el.classList.add("enter");
      }
      el.hidden = !show;
    }
    window.scrollTo(0, 0);
  }

  async function route() {
    if (location.hash === lastHash) return; // 防止 boot 与 hashchange 双触发导致重复打开
    const prev = lastHash;
    lastHash = location.hash;
    const hash = location.hash || "#/library";
    const m = hash.match(/^#\/score\/([^?]+)(?:\?list=([^&]+))?/);
    if (m) {
      showScreen("viewer");
      await Viewer.open(m[1], m[2] || null);
      return;
    }
    if (prev && lastHash.startsWith("#/score")) await Viewer.close();
    if (hash.startsWith("#/setlists")) {
      showScreen("setlists");
      Library.renderSetlists();
      return;
    }
    if (hash.startsWith("#/settings")) {
      showScreen("settings");
      return;
    }
    showScreen("library");
    Library.refresh();
  }

  // ---------- 事件 ----------
  document.getElementById("btn-settings").addEventListener("click", () => location.hash = "#/settings");
  document.getElementById("btn-setlists").addEventListener("click", () => location.hash = "#/setlists");
  document.addEventListener("click", e => {
    const back = e.target.closest("[data-nav]");
    if (back) location.hash = back.dataset.nav;
  });
  document.getElementById("set-theme").addEventListener("change", e => {
    settings.theme = e.target.value;
    saveSettings();
  });
  document.getElementById("set-speed").addEventListener("change", e => {
    settings.scrollSpeed = Math.min(400, Math.max(10, parseInt(e.target.value, 10) || 60));
    saveSettings();
    document.getElementById("v-speed").value = settings.scrollSpeed;
  });
  bindCapture("cap-next", "keyNext");
  bindCapture("cap-prev", "keyPrev");

  // ---------- PWA ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(err =>
        console.warn("SW 注册失败（不影响使用）:", err));
    });
  }

  // ---------- 启动 ----------
  async function boot() {
    await loadSettings();
    // pdf.js worker
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "./js/vendor/pdf.worker.min.js";
    }
    const speedInput = document.getElementById("v-speed");
    speedInput.value = settings.scrollSpeed;
    if (!location.hash) location.hash = "#/library";
    window.addEventListener("hashchange", route);
    await route();
  }

  boot();

  return { settings, saveSettings, showScreen };
})();
