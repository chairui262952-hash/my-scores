/* 我的谱架 — 看谱器（原创实现）
 * 三种模式：滚动（连续）/ 单页 / 半页
 * 键盘/蓝牙踏板翻页、自动滚动、屏幕常亮、亮度与夜间反色、缩放
 */
"use strict";

var Viewer = (() => {
  const stage = document.getElementById("viewer-stage");
  const pagesEl = document.getElementById("pages");
  const topbar = document.getElementById("viewer-topbar");
  const botbar = document.getElementById("viewer-bottombar");
  const tapL = document.getElementById("tap-left");
  const tapR = document.getElementById("tap-right");

  // ---------- 状态 ----------
  let score = null;          // 当前曲谱记录
  let pdfDoc = null;         // pdf.js 文档
  let mode = "scroll";       // scroll | page | half
  let zoom = 1;              // 缩放系数（相对适应宽度）
  let pageNum = 1;
  let pageCount = 0;
  let baseScale = 1;         // PDF 渲染基准（1 css px 对应的 pdf 单位换算）
  let renderedScale = new Map(); // pageWrap -> 已渲染的 scale
  let autoTimer = null;
  let autoSpeed = 60;
  let wakeLock = null;
  let wakeOn = false;
  let queueIds = null;       // 曲单队列
  let hideTimer = null;
  let idleObserver = null;
  let textSteps = 0;         // 文本谱当前移调半音数
  let songChordNames = [];   // 本曲检测到的和弦

  // ---------- 打开 / 关闭 ----------
  async function open(id, listId) {
    score = await DB.getScore(id);
    if (!score) { toast("曲谱不存在"); return; }
    score.openedAt = Date.now();
    await DB.putScore(score);

    queueIds = null;
    if (listId) {
      const l = await DB.getSetlist(listId);
      if (l && l.items.includes(id)) queueIds = l.items;
    }

    document.getElementById("v-title").textContent = score.title;
    document.getElementById("v-prev-score").hidden = !queueIds;
    document.getElementById("v-next-score").hidden = !queueIds;

    APP.showScreen("viewer");
    resetViewer();
    showUI();

    if (score.type === "pdf") {
      const buf = await score.blob.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      pageCount = pdfDoc.numPages;
      score.pages = pageCount;
      await buildPdfPages();
    } else if (score.type === "text") {
      pageCount = 1;
      buildTextPages();
      document.getElementById("v-pageinfo").textContent = "文本谱";
    } else {
      pageCount = 1;
      const url = URL.createObjectURL(score.blob);
      const wrap = makePageWrap(1);
      const img = document.createElement("img");
      img.src = url;
      img.onload = () => { URL.revokeObjectURL(url); };
      wrap.appendChild(img);
      pagesEl.appendChild(wrap);
    }
    if (score.type !== "text") updatePageInfo();
    applyZoom();
  }

  function resetViewer() {
    stage.scrollTop = 0;
    pagesEl.innerHTML = "";
    pagesEl.style.transform = "";
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
    renderedScale.clear();
    if (idleObserver) { idleObserver.disconnect(); idleObserver = null; }
    stopAuto();
    zoom = 1;
    pageNum = 1;
    mode = "scroll";
    document.getElementById("v-zoom-val").textContent = "100%";
    document.getElementById("v-autoscroll").textContent = "▶";
    document.getElementById("v-autoscroll").classList.remove("on");
    const bright = APP.settings.brightness;
    document.getElementById("v-bright").value = bright;
    document.documentElement.style.setProperty("--bright", bright + "%");
    if (APP.settings.invert) document.documentElement.dataset.invert = "1";
    else delete document.documentElement.dataset.invert;
    document.getElementById("v-invert").checked = !!APP.settings.invert;
    document.getElementById("v-wakelock").checked = false;
    // 模式分段复位 + 关闭所有面板
    document.querySelectorAll("#mode-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === "scroll"));
    closeSheets();
    // 文本谱状态复位
    textSteps = 0;
    document.getElementById("t-key").textContent = "C";
    document.getElementById("bar-transpose").hidden = score.type !== "text";
    document.getElementById("sheet-text").hidden = score.type !== "text";
    document.getElementById("chord-search").value = "";
  }

  async function close() {
    if (wakeLock) { try { await wakeLock.release(); } catch (e) {} wakeLock = null; }
    wakeOn = false;
    updateWakeBtn();
    Metronome.stop();
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
    score = null;
    Library.refresh();
  }

  // ---------- PDF 页面构建（懒渲染） ----------
  function makePageWrap(n) {
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.dataset.page = n;
    return wrap;
  }

  async function buildPdfPages() {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= pageCount; i++) {
      const wrap = makePageWrap(i);
      const ph = document.createElement("canvas");
      ph.width = 600; ph.height = 800;
      ph.style.opacity = "0";
      wrap.appendChild(ph);
      frag.appendChild(wrap);
    }
    pagesEl.appendChild(frag);
    observePages();
    // 立即渲染前两页
    await renderPage(1);
    renderPage(2);
  }

  function observePages() {
    idleObserver = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (en.isIntersecting) {
          const n = parseInt(en.target.dataset.page, 10);
          renderPage(n);
          if (n + 1 <= pageCount) renderPage(n + 1);
        }
      }
    }, { root: stage, rootMargin: "120% 0px" });
    pagesEl.querySelectorAll(".page-wrap").forEach(w => idleObserver.observe(w));
  }

  async function renderPage(n) {
    if (!pdfDoc) return;
    const wrap = pagesEl.querySelector(`.page-wrap[data-page="${n}"]`);
    if (!wrap) return;
    const scale = targetScale();
    if (renderedScale.get(wrap.dataset.page) === scale && wrap.querySelector("canvas")) return;
    const page = await pdfDoc.getPage(n);
    const vp = page.getViewport({ scale });
    let canvas = wrap.querySelector("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    canvas.style.opacity = "0";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    canvas.style.opacity = "1";
    renderedScale.set(wrap.dataset.page, scale);
    const tag = wrap.querySelector(".page-num") || (() => {
      const t = document.createElement("span");
      t.className = "page-num";
      wrap.appendChild(t);
      return t;
    })();
    tag.textContent = `${n} / ${pageCount}`;
    if (n === pageNum) updatePageInfo();
  }

  // 计算当前应使用的渲染 scale：pdf 基准单位 → css px
  function targetScale() {
    if (!pdfDoc) return 1;
    // 用第一页宽度计算适应容器宽度的基准，再乘 zoom
    const w = stage.clientWidth - 8;
    if (!Viewer._baseW && pdfDoc) return 1;
    return (w / Viewer._baseW) * zoom;
  }

  async function applyZoom() {
    if (!pdfDoc) return;
    const p1 = await pdfDoc.getPage(1);
    Viewer._baseW = p1.getViewport({ scale: 1 }).width;
    renderedScale.clear();
    pagesEl.querySelectorAll(".page-wrap canvas").forEach(c => { c.style.opacity = "0"; });
    // 清掉旧画布，触发懒渲染重画
    pagesEl.querySelectorAll(".page-wrap").forEach(w => {
      const c = w.querySelector("canvas");
      if (c) { c.width = 0; c.height = 0; }
    });
    const vis = visiblePage();
    await renderPage(vis);
    renderPage(vis + 1 <= pageCount ? vis + 1 : vis);
    document.getElementById("v-zoom-val").textContent = Math.round(zoom * 100) + "%";
  }

  function visiblePage() {
    if (mode === "page") return pageNum;
    const mid = stage.scrollTop + stage.clientHeight / 2;
    for (const w of pagesEl.querySelectorAll(".page-wrap")) {
      if (w.offsetTop <= mid && w.offsetTop + w.offsetHeight >= mid) {
        return parseInt(w.dataset.page, 10);
      }
    }
    return 1;
  }

  // ---------- 模式 / 翻页 ----------
  function setMode(m) {
    mode = m;
    document.querySelectorAll("#mode-seg button").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === m));
    if (m === "page") {
      // 单页模式：只显示当前页
      pagesEl.querySelectorAll(".page-wrap").forEach(w => {
        w.style.display = parseInt(w.dataset.page, 10) === pageNum ? "" : "none";
      });
      renderPage(pageNum);
    } else {
      pagesEl.querySelectorAll(".page-wrap").forEach(w => { w.style.display = ""; });
    }
  }

  function turnPage(dir) {
    if (!score) return;
    if (mode === "scroll" || mode === "half") {
      const step = mode === "half" ? stage.clientHeight * 0.85 : stage.clientHeight * 0.95;
      if (dir > 0) {
        if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4) {
          toast("已是最后一页");
          return;
        }
        stage.scrollBy({ top: step, behavior: "smooth" });
      } else {
        if (stage.scrollTop <= 0) { toast("已是第一页"); return; }
        stage.scrollBy({ top: -step, behavior: "smooth" });
      }
      return;
    }
    // 单页模式
    const next = pageNum + dir;
    if (next < 1) { toast("已是第一页"); return; }
    if (next > pageCount) { toast("已是最后一页"); return; }
    gotoPage(next);
  }

  function gotoPage(n) {
    if (n < 1 || n > pageCount) return;
    pageNum = n;
    if (mode === "page") {
      pagesEl.querySelectorAll(".page-wrap").forEach(w => {
        w.style.display = parseInt(w.dataset.page, 10) === n ? "" : "none";
      });
      renderPage(n);
      stage.scrollTop = 0;
    } else {
      const wrap = pagesEl.querySelector(`.page-wrap[data-page="${n}"]`);
      if (wrap) stage.scrollTo({ top: wrap.offsetTop - 4, behavior: "smooth" });
    }
    updatePageInfo();
  }

  function updatePageInfo() {
    if (!score) return;
    if (score.type === "text") {
      document.getElementById("v-pageinfo").textContent = "文本谱";
      return;
    }
    const vis = pageCount > 0 ? (mode === "page" ? pageNum : visiblePage()) : 1;
    pageNum = vis;
    document.getElementById("v-pageinfo").textContent = pageCount ? `${vis} / ${pageCount}` : "";
  }

  // ---------- 自动滚动 ----------
  function startAuto() {
    if (mode === "page") setMode("scroll");
    autoSpeed = parseInt(document.getElementById("v-speed").value, 10) || currentDefaultSpeed();
    stopAuto();
    let last = performance.now();
    const loop = now => {
      const dt = (now - last) / 1000;
      last = now;
      stage.scrollTop += autoSpeed * dt;
      if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1) {
        stopAuto();
        toast("已滚动到底部");
        return;
      }
      autoTimer = requestAnimationFrame(loop);
    };
    autoTimer = requestAnimationFrame(loop);
    const btn = document.getElementById("v-autoscroll");
    btn.textContent = "⏸";
    btn.classList.add("on");
  }
  function stopAuto() {
    if (autoTimer) { cancelAnimationFrame(autoTimer); autoTimer = null; }
    const btn = document.getElementById("v-autoscroll");
    btn.textContent = "▶";
    btn.classList.remove("on");
  }
  function toggleAuto() {
    autoTimer ? (stopAuto()) : startAuto();
  }

  // ---------- 屏幕常亮 ----------
  async function toggleWake() {
    if (wakeOn) {
      if (wakeLock) { try { await wakeLock.release(); } catch (e) {} wakeLock = null; }
      wakeOn = false;
    } else {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeOn = true;
        wakeLock.addEventListener("release", () => { wakeOn = false; updateWakeBtn(); });
      } catch (e) {
        toast("屏幕常亮不可用：" + (e.message || e));
      }
    }
    updateWakeBtn();
  }
  function updateWakeBtn() {
    document.getElementById("v-wakelock").checked = wakeOn;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeOn && !wakeLock) {
      navigator.wakeLock.request("screen").then(l => { wakeLock = l; }).catch(() => {});
    }
  });

  // ---------- UI 显隐 ----------
  function showUI() {
    topbar.classList.remove("hidden-ui");
    botbar.classList.remove("hidden-ui");
    tapL.style.display = ""; tapR.style.display = "";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideUI, 3500);
  }
  function hideUI() {
    topbar.classList.add("hidden-ui");
    botbar.classList.add("hidden-ui");
  }
  ["pointermove", "pointerdown", "wheel", "touchstart"].forEach(ev =>
    stage.addEventListener(ev, () => showUI(), { passive: true }));
  // 操作工具条本身时保持可见并重置计时（按 ID 查找，避免模块加载顺序问题）
  ["viewer-topbar", "viewer-bottombar", "more-sheet", "chord-panel"].forEach(id =>
    document.getElementById(id).addEventListener("pointerdown", () => showUI()));

  // 点击翻页区：左右永远直接翻页，中间区切换工具条显隐
  const tapC = document.getElementById("tap-center");
  tapL.addEventListener("click", () => { showUI(); turnPage(-1); });
  tapR.addEventListener("click", () => { showUI(); turnPage(1); });
  tapC.addEventListener("click", () => {
    if (topbar.classList.contains("hidden-ui")) showUI();
    else hideUI();
  });

  // 滚动时实时更新页码
  let scrollRaf = null;
  stage.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (score && mode !== "page") updatePageInfo();
    });
  }, { passive: true });

  // ---------- 键盘 / 踏板 ----------
  function keyName(e) {
    let k = e.key;
    if (k === " ") k = "Space";
    return k;
  }
  document.addEventListener("keydown", e => {
    if (!score) return;
    const t = e.target;
    if (t instanceof Element && t.matches("input, select, textarea")) return;
    const k = keyName(e);
    if (k === APP.settings.keyNext) { e.preventDefault(); turnPage(1); }
    else if (k === APP.settings.keyPrev) { e.preventDefault(); turnPage(-1); }
    else if (k === "Space") { e.preventDefault(); toggleAuto(); }
  });

  // ---------- 曲单内切换 ----------
  async function jumpScore(dir) {
    if (!queueIds) return;
    const i = queueIds.indexOf(score.id);
    const j = i + dir;
    if (j < 0 || j >= queueIds.length) { toast(dir > 0 ? "曲单最后一首" : "曲单第一首"); return; }
    stopAuto();
    await open(queueIds[j], null);
    // 保留队列
    queueIds = null;
    const l = await DB.getSetlist(currentQueueListId());
    // 重新拉取队列
  }
  function currentQueueListId() { return Viewer._queueListId || null; }

  // ---------- 文本和弦谱 ----------
  function buildTextPages() {
    const wrap = makePageWrap(1);
    wrap.style.width = "100%";
    const page = document.createElement("div");
    page.className = "text-page";
    page.style.setProperty("--text-size", (score.textSize || 16) + "px");
    const pre = document.createElement("pre");
    pre.id = "text-content";
    page.appendChild(pre);
    wrap.appendChild(page);
    pagesEl.appendChild(wrap);
    applyTextSteps();
  }

  function applyTextSteps() {
    const pre = document.getElementById("text-content");
    if (!pre) return;
    pre.innerHTML = Chords.renderTextHtml(score.content || "", textSteps);
    songChordNames = Chords.collectFrom(score.content || "", textSteps);
    // 调性显示：以原调 C 为基准（文本谱没有调号信息，按移定量显示）
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    document.getElementById("t-key").textContent = names[((textSteps % 12) + 12) % 12];
    // 和弦面板若打开则刷新本曲和弦区
    if (document.getElementById("chord-panel").classList.contains("open")) renderSongChords();
  }

  function setTextSize(delta) {
    const cur = parseInt(getComputedStyle(document.querySelector(".text-page")).getPropertyValue("--text-size")) || (score.textSize || 16);
    const next = Math.min(34, Math.max(11, cur + delta));
    score.textSize = next;
    document.querySelector(".text-page").style.setProperty("--text-size", next + "px");
    DB.putScore(score);
  }

  // ---------- 底部面板系统 ----------
  const backdrop = document.getElementById("sheet-backdrop");
  const moreSheet = document.getElementById("more-sheet");
  const chordSheet = document.getElementById("chord-panel");
  function openSheet(el) {
    closeSheets();
    el.classList.add("open");
    backdrop.classList.add("open");
  }
  function closeSheets() {
    moreSheet.classList.remove("open");
    chordSheet.classList.remove("open");
    backdrop.classList.remove("open");
  }

  function openChordSheet() {
    renderSongChords();
    renderChordGrid(document.getElementById("chord-search").value.trim());
    openSheet(chordSheet);
  }

  function renderSongChords() {
    const sec = document.getElementById("song-chords-sec");
    if (!score || score.type !== "text" || !songChordNames.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const box = document.getElementById("song-chords");
    box.innerHTML = "";
    for (const name of songChordNames) {
      box.appendChild(chordCell(name));
    }
  }

  function chordCell(name) {
    const cell = document.createElement("div");
    cell.className = "chord-cell";
    const c = document.createElement("canvas");
    cell.appendChild(c);
    Chords.draw(c, name);
    return cell;
  }

  function renderChordGrid(filter) {
    const grid = document.getElementById("chord-grid");
    grid.innerHTML = "";
    for (const c of Chords.LIB) {
      if (filter && !c.n.toLowerCase().includes(filter.toLowerCase())) continue;
      grid.appendChild(chordCell(c.n));
    }
    if (!grid.children.length) {
      grid.innerHTML = `<p class="hint">没有匹配「${filter}」的和弦</p>`;
    }
  }

  // ---------- 提示 ----------
  function toast(msg, ms = 2200) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- 工具条事件 ----------
  document.getElementById("v-back").addEventListener("click", () => {
    closeSheets();
    close();
    location.hash = "#/library";
  });
  // 底栏：翻页 / 更多
  document.getElementById("v-turn-prev").addEventListener("click", () => turnPage(-1));
  document.getElementById("v-turn-next").addEventListener("click", () => turnPage(1));
  document.getElementById("v-more").addEventListener("click", () => openSheet(moreSheet));
  document.getElementById("more-close").addEventListener("click", closeSheets);
  backdrop.addEventListener("click", closeSheets);
  // 模式分段
  document.querySelectorAll("#mode-seg button").forEach(b =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.getElementById("v-autoscroll").addEventListener("click", toggleAuto);
  document.getElementById("v-speed").addEventListener("input", e => {
    autoSpeed = parseInt(e.target.value, 10);
    APP.settings.scrollSpeed = autoSpeed;
    APP.saveSettings();
  });
  document.getElementById("v-zoom-in").addEventListener("click", () => { zoom = Math.min(2.5, zoom + 0.1); applyZoom(); });
  document.getElementById("v-zoom-out").addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.1); applyZoom(); });
  document.getElementById("v-bright").addEventListener("input", e => {
    const v = parseInt(e.target.value, 10);
    document.documentElement.style.setProperty("--bright", v + "%");
    APP.settings.brightness = v;
    APP.saveSettings();
  });
  document.getElementById("v-invert").addEventListener("change", e => {
    if (e.target.checked) document.documentElement.dataset.invert = "1";
    else delete document.documentElement.dataset.invert;
    APP.settings.invert = e.target.checked;
    APP.saveSettings();
  });
  document.getElementById("v-wakelock").addEventListener("change", () => {
    toggleWake().catch(() => {});
  });
  document.getElementById("v-chords").addEventListener("click", openChordSheet);
  document.getElementById("chord-close").addEventListener("click", closeSheets);
  document.getElementById("v-prev-score").addEventListener("click", () => jumpScore(-1));
  document.getElementById("v-next-score").addEventListener("click", () => jumpScore(1));

  // 和弦过滤
  document.getElementById("chord-search").addEventListener("input", e =>
    renderChordGrid(e.target.value.trim()));

  // 节拍器（在看谱设置面板内）
  const mBpm = document.getElementById("m-bpm");
  mBpm.addEventListener("input", () => {
    Metronome.setBPM(parseInt(mBpm.value, 10));
    document.getElementById("m-bpm-val").textContent = mBpm.value;
  });
  document.getElementById("m-beats").addEventListener("change", e => Metronome.setBeats(parseInt(e.target.value, 10)));
  document.getElementById("m-toggle").addEventListener("click", () => {
    const running = Metronome.toggle();
    document.getElementById("m-toggle").textContent = running ? "停止" : "开始";
  });

  // 文本谱：移调与字号
  document.getElementById("t-up").addEventListener("click", () => { textSteps = (textSteps + 1) % 12; applyTextSteps(); });
  document.getElementById("t-down").addEventListener("click", () => { textSteps = (textSteps + 11) % 12; applyTextSteps(); });
  document.getElementById("t-reset").addEventListener("click", () => { textSteps = 0; applyTextSteps(); });
  document.getElementById("fs-up").addEventListener("click", () => setTextSize(1));
  document.getElementById("fs-down").addEventListener("click", () => setTextSize(-1));

  // 默认速度由 APP.boot 注入（见 app.js），这里懒读取，避免脚本加载顺序问题
  function currentDefaultSpeed() {
    return (window.APP && APP.settings && APP.settings.scrollSpeed) || 60;
  }

  return { open, close, toast, turnPage, gotoPage, setMode, toggleAuto };
})();
