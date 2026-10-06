/* 我的谱架 — 曲谱库 / 导入 / 曲单 / 备份（原创实现） */
"use strict";

var Library = (() => {
  const grid = document.getElementById("lib-grid");
  const emptyHint = document.getElementById("lib-empty");
  let cache = [];          // 全量曲谱元数据（不含 blob 引用使用）
  let currentSetlist = null;

  // ---------- 渲染 ----------
  let chipFilter = "all";   // all | fav | text

  async function refresh() {
    cache = (await DB.allScores()).sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt));
    const sub = document.getElementById("lib-sub");
    if (sub) {
      const favs = cache.filter(s => s.fav).length;
      sub.textContent = `${cache.length} 份曲谱 · ${favs} 份收藏 · 本机保存`;
    }
    render(applyFilters());
  }

  let filterStr = "";
  function applyFilters() {
    let list = cache;
    if (chipFilter === "fav") list = list.filter(s => s.fav);
    else if (chipFilter === "text") list = list.filter(s => s.type === "text");
    const q = filterStr.toLowerCase();
    if (q) {
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        (s.artist || "").toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q)));
    }
    return list;
  }

  function render(list) {
    grid.innerHTML = "";
    emptyHint.hidden = list.length > 0;
    list.forEach((s, i) => {
      const card = document.createElement("div");
      card.className = "score-card";
      card.style.setProperty("--i", i);
      const thumb = s.thumb
        ? `<img class="thumb" src="${s.thumb}" alt="">`
        : `<div class="thumb-blank">🎼</div>`;
      card.innerHTML = `
        ${thumb}
        <button class="menu" title="更多">⋯</button>
        <button class="fav ${s.fav ? "lit" : ""}" title="收藏">${s.fav ? "★" : "☆"}</button>
        <div class="meta">
          <div class="name"></div>
          <div class="info">${s.type === "text" ? "文本谱 · 可移调" : (s.pages || "?") + " 页"} · ${fmtDate(s.openedAt || s.addedAt)}</div>
        </div>`;
      card.querySelector(".name").textContent = s.title;
      card.addEventListener("click", e => {
        if (e.target.closest(".fav")) return;
        if (e.target.closest(".menu")) return;
        location.hash = `#/score/${s.id}`;
      });
      card.querySelector(".fav").addEventListener("click", async e => {
        e.stopPropagation();
        s.fav = s.fav ? 0 : 1;
        await DB.putScore(s);
        e.target.textContent = s.fav ? "★" : "☆";
        e.target.classList.toggle("lit", !!s.fav);
        if (chipFilter === "fav") render(applyFilters());
      });
      card.querySelector(".menu").addEventListener("click", e => {
        e.stopPropagation();
        showScoreMenu(s);
      });
      grid.appendChild(card);
    });
  }

  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ---------- 曲谱操作 ----------
  function showScoreMenu(s) {
    const dlg = makeDialog("「" + s.title + "」");
    const body = document.createElement("div");
    body.className = "pick-list";
    const actions = [
      ["✏️ 编辑信息", () => editMetaDialog(s)],
      ...(s.type === "text" ? [["📝 编辑内容", () => editTextContent(s)]] : []),
      ["🎸 添加到曲单", () => pickSetlistAndAdd(s.id)],
      ["🗑 删除", async () => {
        if (confirm(`确定删除「${s.title}」？此操作不可恢复。`)) {
          await DB.delScore(s.id);
        }
      }],
    ];
    for (const [label, fn] of actions) {
      const it = document.createElement("div");
      it.className = "pick-item";
      it.textContent = label;
      it.addEventListener("click", () => { dlg.close(); fn(); refresh(); });
      body.appendChild(it);
    }
    dlg.appendChild(body);
    dlg.appendChild(dialogActions(dlg));
    dlg.showModal();
  }

  // 编辑标题 / 歌手 / 标签
  function editMetaDialog(s) {
    const dlg = makeDialog("编辑信息");
    const mk = (label, value, isInput = true) => {
      const row = document.createElement("div");
      row.className = "row";
      const lab = document.createElement("label");
      lab.textContent = label;
      row.appendChild(lab);
      let el;
      if (isInput) {
        el = document.createElement("input");
        el.type = "text";
        el.value = value || "";
      } else {
        el = document.createElement("textarea");
        el.rows = 3;
        el.value = value || "";
        el.style.cssText = "flex:1;background:var(--bg2);color:var(--text);border:1px solid #3a4654;border-radius:8px;padding:8px;font-size:14px;";
      }
      row.appendChild(el);
      dlg.appendChild(row);
      return el;
    };
    const titleIn = mk("曲名", s.title);
    const artistIn = mk("歌手/原唱", s.artist);
    const tagsIn = mk("标签（逗号分隔）", (s.tags || []).join(", "));
    const bar = document.createElement("div");
    bar.className = "dlg-actions";
    const save = document.createElement("button");
    save.className = "primary small";
    save.textContent = "保存";
    save.addEventListener("click", async () => {
      s.title = titleIn.value.trim() || s.title;
      s.artist = artistIn.value.trim();
      s.tags = tagsIn.value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
      await DB.putScore(s);
      dlg.close();
      refresh();
      toast("已保存");
    });
    const cancel = document.createElement("button");
    cancel.className = "small";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => dlg.close());
    bar.append(save, cancel);
    dlg.appendChild(bar);
    dlg.showModal();
  }

  // 编辑文本谱内容
  function editTextContent(s) {
    const dlg = makeDialog("编辑文本谱内容");
    const ta = document.createElement("textarea");
    ta.rows = 12;
    ta.value = s.content || "";
    ta.style.cssText = "width:100%;background:var(--bg2);color:var(--text);border:1px solid #3a4654;border-radius:8px;padding:10px;font-size:14px;font-family:monospace;";
    dlg.appendChild(ta);
    const bar = document.createElement("div");
    bar.className = "dlg-actions";
    const save = document.createElement("button");
    save.className = "primary small";
    save.textContent = "保存";
    save.addEventListener("click", async () => {
      s.content = ta.value;
      await DB.putScore(s);
      dlg.close();
      refresh();
      toast("内容已更新，重新打开生效");
    });
    const cancel = document.createElement("button");
    cancel.className = "small";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => dlg.close());
    bar.append(save, cancel);
    dlg.appendChild(bar);
    dlg.showModal();
  }

  // 新建文本和弦谱
  function newTextScoreDialog() {
    const dlg = makeDialog("新建文本和弦谱");
    const titleIn = document.createElement("input");
    titleIn.type = "text";
    titleIn.placeholder = "曲名（必填）";
    dlg.appendChild(titleIn);
    const ta = document.createElement("textarea");
    ta.rows = 12;
    ta.placeholder = "粘贴和弦谱文本，例如：\n\nC        G\n风继续吹 不忍远离\nAm       F    G   C\n心里亦有泪却不愿哭泣";
    ta.style.cssText = "width:100%;background:var(--bg2);color:var(--text);border:1px solid #3a4654;border-radius:8px;padding:10px;font-size:14px;font-family:monospace;margin-top:8px;";
    dlg.appendChild(ta);
    const bar = document.createElement("div");
    bar.className = "dlg-actions";
    const save = document.createElement("button");
    save.className = "primary small";
    save.textContent = "保存";
    save.addEventListener("click", async () => {
      const title = titleIn.value.trim();
      if (!title) { toast("请先填曲名"); return; }
      await DB.putScore({
        id: DB.uuid(),
        title,
        artist: "",
        tags: ["文本谱"],
        type: "text",
        content: ta.value,
        pages: 1,
        thumb: null,
        addedAt: Date.now(),
        openedAt: 0,
        fav: 0,
      });
      dlg.close();
      refresh();
      toast("已创建，打开即可移调");
    });
    const cancel = document.createElement("button");
    cancel.className = "small";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => dlg.close());
    bar.append(save, cancel);
    dlg.appendChild(bar);
    dlg.showModal();
  }

  async function pickSetlistAndAdd(scoreId) {
    const lists = await DB.allSetlists();
    const dlg = makeDialog("添加到曲单");
    const body = document.createElement("div");
    body.className = "pick-list";
    for (const l of lists) {
      const it = document.createElement("div");
      it.className = "pick-item";
      it.textContent = `📁 ${l.name}（${l.items.length} 首）`;
      it.addEventListener("click", async () => {
        if (!l.items.includes(scoreId)) l.items.push(scoreId);
        await DB.putSetlist(l);
        dlg.close();
        toast(`已加入曲单「${l.name}」`);
      });
      body.appendChild(it);
    }
    if (!lists.length) {
      const p = document.createElement("p");
      p.className = "hint"; p.textContent = "还没有曲单，先去「曲单」页新建一个吧。";
      body.appendChild(p);
    }
    dlg.appendChild(body);
    dlg.appendChild(dialogActions(dlg));
    dlg.showModal();
  }

  // ---------- 导入 ----------
  async function importFiles(fileList) {
    const files = [...fileList];
    let ok = 0;
    for (const f of files) {
      try {
        const isPDF = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
        const isImg = f.type.startsWith("image/");
        if (!isPDF && !isImg) continue;
        const blob = f.slice(0, f.size, f.type || (isPDF ? "application/pdf" : "image/png"));
        const score = {
          id: DB.uuid(),
          title: f.name.replace(/\.(pdf|jpe?g|png|webp|gif|bmp)$/i, ""),
          artist: "",
          tags: [],
          type: isPDF ? "pdf" : "image",
          mime: blob.type,
          blob,
          pages: isImg ? 1 : 0,
          thumb: null,
          addedAt: Date.now(),
          openedAt: 0,
          fav: 0,
        };
        if (isPDF) {
          const info = await pdfThumbnail(blob);
          score.thumb = info.thumb;
          score.pages = info.pages;
        } else {
          score.thumb = await imgThumbnail(blob);
        }
        await DB.putScore(score);
        ok++;
      } catch (err) {
        console.error("导入失败:", f.name, err);
        toast(`「${f.name}」导入失败：${err.message || err}`);
      }
    }
    if (ok) toast(`已导入 ${ok} 份曲谱`);
    await refresh();
  }

  // 生成 PDF 首页缩略图（使用本地内置 pdf.js）
  async function pdfThumbnail(blob) {
    const buf = await blob.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(300 / vp.width, 400 / vp.height, 1.2);
    const v2 = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(v2.width);
    canvas.height = Math.ceil(v2.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: v2 }).promise;
    const thumb = canvas.toDataURL("image/jpeg", 0.75);
    const pages = doc.numPages;
    doc.destroy();
    return { thumb, pages };
  }

  async function imgThumbnail(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("图片无法解析"));
        i.src = url;
      });
      const scale = Math.min(300 / img.width, 400 / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.75);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 曲单 ----------
  async function renderSetlists() {
    const wrap = document.getElementById("setlist-list");
    const detail = document.getElementById("setlist-detail");
    detail.hidden = true; wrap.hidden = false;
    const lists = await DB.allSetlists();
    wrap.innerHTML = "";
    if (!lists.length) {
      wrap.innerHTML = `<p class="hint" style="text-align:center;padding:40px 0">
        曲单用来把演出要唱的歌排成一串，看谱时可以快速切下一首。<br>点击右上角「新建」创建第一个曲单。</p>`;
      return;
    }
    for (const l of lists.sort((a, b) => a.createdAt - b.createdAt)) {
      const it = document.createElement("div");
      it.className = "list-item";
      it.innerHTML = `<div class="grow">
          <div class="name"></div>
          <div class="info">${l.items.length} 首</div>
        </div>
        <button class="small del">删除</button>`;
      it.querySelector(".name").textContent = "📁 " + l.name;
      it.addEventListener("click", e => {
        if (e.target.closest(".del")) return;
        renderSetlistDetail(l.id);
      });
      it.querySelector(".del").addEventListener("click", async e => {
        e.stopPropagation();
        if (confirm(`删除曲单「${l.name}」？（不会删除曲谱本身）`)) {
          await DB.delSetlist(l.id);
          renderSetlists();
        }
      });
      wrap.appendChild(it);
    }
  }

  async function renderSetlistDetail(id) {
    const l = await DB.getSetlist(id);
    if (!l) { renderSetlists(); return; }
    currentSetlist = l;
    const wrap = document.getElementById("setlist-list");
    const detail = document.getElementById("setlist-detail");
    wrap.hidden = true; detail.hidden = false;
    detail.innerHTML = `<p class="hint">曲单「${l.name}」— 点击曲谱开始，看谱页可用 ⏮⏭ 切换</p>`;
    for (const sid of l.items) {
      const s = await DB.getScore(sid);
      if (!s) continue;
      const it = document.createElement("div");
      it.className = "list-item";
      it.innerHTML = `<div class="grow">
          <div class="name"></div>
          <div class="info">${s.pages || "?"} 页</div>
        </div>
        <button class="small up">↑</button>
        <button class="small down">↓</button>
        <button class="small rm">移出</button>`;
      it.querySelector(".name").textContent = s.title;
      it.addEventListener("click", e => {
        if (e.target.closest("button")) return;
        location.hash = `#/score/${sid}?list=${l.id}`;
      });
      it.querySelector(".up").addEventListener("click", () => moveItem(l, sid, -1));
      it.querySelector(".down").addEventListener("click", () => moveItem(l, sid, +1));
      it.querySelector(".rm").addEventListener("click", async () => {
        l.items = l.items.filter(x => x !== sid);
        await DB.putSetlist(l);
        renderSetlistDetail(l.id);
      });
      detail.appendChild(it);
    }
  }

  async function moveItem(l, sid, dir) {
    const i = l.items.indexOf(sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= l.items.length) return;
    [l.items[i], l.items[j]] = [l.items[j], l.items[i]];
    await DB.putSetlist(l);
    renderSetlistDetail(l.id);
  }

  // ---------- 备份 ----------
  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  function b64ToBlob(dataurl) {
    const [head, b64] = dataurl.split(",");
    const mime = (head.match(/data:(.*?);/) || [])[1] || "application/octet-stream";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function exportBackup() {
    const scores = await DB.allScores();
    const lists = await DB.allSetlists();
    const out = { app: "my-stand", version: 1, exportedAt: Date.now(), setlists: lists, scores: [] };
    for (const s of scores) {
      const { blob, ...meta } = s;
      out.scores.push({ meta, data: await blobToB64(blob) });
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-stand-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("备份已导出");
  }

  async function importBackup(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.app !== "my-stand") throw new Error("不是本应用的备份文件");
    for (const item of data.scores) {
      const meta = { ...item.meta };
      meta.blob = b64ToBlob(item.data);
      const exists = await DB.getScore(meta.id);
      if (exists) meta.id = DB.uuid();
      await DB.putScore(meta);
    }
    for (const l of data.setlists || []) await DB.putSetlist(l);
    await refresh();
    toast("备份导入完成");
  }

  // ---------- 通用 ----------
  function makeDialog(title) {
    const dlg = document.createElement("dialog");
    const h = document.createElement("h3");
    h.textContent = title;
    dlg.appendChild(h);
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    return dlg;
  }
  function dialogActions(dlg) {
    const bar = document.createElement("div");
    bar.className = "dlg-actions";
    const btn = document.createElement("button");
    btn.className = "small";
    btn.textContent = "关闭";
    btn.addEventListener("click", () => dlg.close());
    bar.appendChild(btn);
    return bar;
  }
  function toast(msg, ms = 2200) {
    // 用 window.Viewer 而非裸标识符：viewer.js 初始化失败时该绑定处于 TDZ，typeof 也会抛错
    if (window.Viewer && window.Viewer.toast) { window.Viewer.toast(msg, ms); return; }
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- 事件绑定 ----------
  const fileInput = document.getElementById("file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  document.getElementById("btn-new-text").addEventListener("click", newTextScoreDialog);
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) importFiles(fileInput.files);
    fileInput.value = "";
  });
  document.getElementById("search").addEventListener("input", e => {
    filterStr = e.target.value.trim();
    render(applyFilters());
  });
  // 筛选 chips
  document.querySelectorAll("#lib-chips .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      chipFilter = btn.dataset.f;
      document.querySelectorAll("#lib-chips .chip").forEach(b =>
        b.classList.toggle("active", b === btn));
      render(applyFilters());
    });
  });
  document.getElementById("btn-new-setlist").addEventListener("click", async () => {
    const name = prompt("曲单名称：");
    if (name && name.trim()) {
      await DB.putSetlist({ id: DB.uuid(), name: name.trim(), items: [], createdAt: Date.now() });
      renderSetlists();
    }
  });
  document.getElementById("btn-export").addEventListener("click", exportBackup);
  const backupInput = document.getElementById("backup-input");
  document.getElementById("btn-import-backup").addEventListener("click", () => backupInput.click());
  backupInput.addEventListener("change", async () => {
    if (backupInput.files[0]) {
      try { await importBackup(backupInput.files[0]); }
      catch (err) { toast("导入失败：" + err.message, 3200); }
    }
    backupInput.value = "";
  });
  // 存储用量展示
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      const mb = n => (n / 1048576).toFixed(1);
      const el = document.getElementById("storage-info");
      if (el) el.textContent = `已用 ${mb(usage)} MB / 可用约 ${mb(quota)} MB`;
    });
  }

  return { refresh, renderSetlists, renderSetlistDetail, toast };
})();
