/* 我的谱架 — 和弦模块（原创实现）
 * 1) 常用和弦指法库 + Canvas 指法图绘制
 * 2) 和弦符号解析 / 移调 / 文本中和弦高亮
 * 指法为吉他通用按法（六弦从低音 E 到高音 e，-1=不弹，0=空弦）
 */
"use strict";

var Chords = (() => {
  // ---------- 指法库 ----------
  // f: 六根弦的品位；b: 横按品位（1=上琴枕横按）
  const LIB = [
    { n: "C",     f: [-1, 3, 2, 0, 1, 0] },
    { n: "D",     f: [-1, -1, 0, 2, 3, 2] },
    { n: "E",     f: [0, 2, 2, 1, 0, 0] },
    { n: "F",     f: [1, 3, 3, 2, 1, 1], b: 1 },
    { n: "G",     f: [3, 2, 0, 0, 0, 3] },
    { n: "A",     f: [-1, 0, 2, 2, 2, 0] },
    { n: "B",     f: [-1, 2, 4, 4, 4, 2], b: 2 },
    { n: "Am",    f: [-1, 0, 2, 2, 1, 0] },
    { n: "Bm",    f: [-1, 2, 4, 4, 3, 2], b: 2 },
    { n: "Cm",    f: [-1, 3, 5, 5, 4, 3], b: 3 },
    { n: "Dm",    f: [-1, -1, 0, 2, 3, 1] },
    { n: "Em",    f: [0, 2, 2, 0, 0, 0] },
    { n: "Fm",    f: [1, 3, 3, 1, 1, 1], b: 1 },
    { n: "F#m",   f: [2, 4, 4, 2, 2, 2], b: 2 },
    { n: "Gm",    f: [3, 5, 5, 3, 3, 3], b: 3 },
    { n: "C7",    f: [-1, 3, 2, 3, 1, 0] },
    { n: "D7",    f: [-1, -1, 0, 2, 1, 2] },
    { n: "E7",    f: [0, 2, 0, 1, 0, 0] },
    { n: "G7",    f: [3, 2, 0, 0, 0, 1] },
    { n: "A7",    f: [-1, 0, 2, 0, 2, 0] },
    { n: "B7",    f: [-1, 2, 1, 2, 0, 2] },
    { n: "Am7",   f: [-1, 0, 2, 0, 1, 0] },
    { n: "Em7",   f: [0, 2, 0, 0, 0, 0] },
    { n: "Dm7",   f: [-1, -1, 0, 2, 1, 1] },
    { n: "Cmaj7", f: [-1, 3, 2, 0, 0, 0] },
    { n: "Fmaj7", f: [1, -1, 2, 2, 1, 0] },
    { n: "Dmaj7", f: [-1, -1, 0, 2, 2, 2] },
    { n: "Dsus4", f: [-1, -1, 0, 2, 3, 3] },
    { n: "Asus4", f: [-1, 0, 2, 2, 3, 0] },
    { n: "Cadd9", f: [-1, 3, 2, 0, 3, 0] },
    { n: "Bb",    f: [-1, 1, 3, 3, 3, 1], b: 1 },
  ];

  // ---------- 和弦符号解析 ----------
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SUFFIXES = new Set([
    "", "m", "7", "m7", "maj7", "maj9", "sus2", "sus4", "7sus4",
    "dim", "dim7", "aug", "add9", "add2", "6", "m6", "9", "m9", "5", "11", "13",
  ]);
  const TOKEN_RE = /^([A-G])(#|b)?(.+)$/;

  // 解析单个和弦标记（含低音斜杠），返回 {root, suffix, bass} 或 null
  function parse(token) {
    if (!token) return null;
    const slash = token.split("/");
    const main = parseSimple(slash[0]);
    if (!main) return null;
    let bass = null;
    if (slash[1]) {
      const b = parseSimple(slash[1]);
      if (!b) return null;
      bass = b.root;
    }
    return { root: main.root, suffix: main.suffix, bass };
  }
  function parseSimple(s) {
    const m = TOKEN_RE.exec(s);
    if (!m) {
      // 无后缀的单字母和弦，如 "C"
      return /^[A-G]$/.test(s) ? { root: NOTES.indexOf(s), suffix: "" } : null;
    }
    if (!SUFFIXES.has(m[3])) return null;
    let root = NOTES.indexOf(m[1]);
    if (m[2] === "#") root += 1;
    if (m[2] === "b") root -= 1;
    root = (root + 12) % 12;
    return { root, suffix: m[3] };
  }

  function noteName(i) {
    return NOTES[((i % 12) + 12) % 12];
  }

  // 移调：steps 为半音数（可正可负）
  function transposeToken(token, steps) {
    const p = parse(token);
    if (!p) return token;
    let out = noteName(p.root + steps) + p.suffix;
    if (p.bass !== null) out += "/" + noteName(p.bass + steps);
    return out;
  }

  // ---------- 文本渲染：高亮 + 收集 ----------
  function isChordToken(tok) { return parse(tok) !== null; }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 把文本转为 HTML：和弦标记包上 <span class="chord" data-chord="...">，其余转义
  function renderTextHtml(text, steps = 0) {
    return text.split("\n").map(line => {
      const parts = line.split(/(\s+)/);
      return parts.map(tok => {
        if (tok.trim() === "") return tok.replace(/ /g, "\u00a0"); // 保留对齐空格
        const p = parse(tok);
        if (p) {
          const t = steps ? transposeToken(tok, steps) : tok;
          return `<span class="chord" data-chord="${t}">${t}</span>`;
        }
        return escapeHtml(tok);
      }).join("");
    }).join("\n");
  }

  // 收集文本里出现过的和弦（按出现顺序去重）
  function collectFrom(text, steps = 0) {
    const seen = [];
    for (const line of text.split("\n")) {
      for (const tok of line.split(/\s+/)) {
        if (!tok) continue;
        const p = parse(tok);
        if (p) {
          const t = steps ? transposeToken(tok, steps) : tok;
          if (!seen.includes(t)) seen.push(t);
        }
      }
    }
    return seen;
  }

  // ---------- 指法图绘制 ----------
  function draw(canvas, chordName) {
    const chord = LIB.find(c => c.n === chordName);
    const dpr = window.devicePixelRatio || 1;
    const W = 84, H = 104;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    if (!chord) { // 库里没有的按法：只显示名字
      ctx.fillStyle = "#8a97a5";
      ctx.font = "600 13px system-ui";
      ctx.fillText(chordName, W / 2, H / 2);
      return;
    }
    // 名字
    ctx.fillStyle = "#e8edf2";
    ctx.font = "700 14px system-ui";
    ctx.fillText(chord.n, W / 2, 15);
    // 网格参数
    const left = 17, top = 28, gw = 50, fh = 15;
    const sw = gw / 5;
    const frets = 4;
    const base = chord.b || 1;
    // 品位数字标注（非首品时）
    if (base > 1) {
      ctx.fillStyle = "#8a97a5";
      ctx.font = "10px system-ui";
      ctx.fillText(String(base), left - 10, top + fh * 0.5 + 4);
    }
    // 弦（竖线）
    ctx.strokeStyle = "#9aa7b4";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(left + i * sw, top);
      ctx.lineTo(left + i * sw, top + frets * fh);
      ctx.stroke();
    }
    // 品（横线）
    for (let r = 0; r <= frets; r++) {
      ctx.beginPath();
      const y = top + r * fh;
      if (r === 0 && base === 1) { ctx.lineWidth = 3.5; ctx.strokeStyle = "#e8edf2"; }
      else { ctx.lineWidth = 1; ctx.strokeStyle = "#9aa7b4"; }
      ctx.moveTo(left, y);
      ctx.lineTo(left + gw, y);
      ctx.stroke();
    }
    // 品位标记点 / x o
    ctx.font = "10px system-ui";
    for (let i = 0; i < 6; i++) {
      const f = chord.f[i];
      const x = left + i * sw + sw / 2;
      if (f === -1) {
        ctx.strokeStyle = "#8a97a5"; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 3.5, top - 9); ctx.lineTo(x + 3.5, top - 3);
        ctx.moveTo(x + 3.5, top - 9); ctx.lineTo(x - 3.5, top - 3);
        ctx.stroke();
      } else if (f === 0) {
        ctx.strokeStyle = "#9aa7b4"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, top - 6, 3, 0, Math.PI * 2); ctx.stroke();
      } else {
        const row = base === 1 ? f : f - base + 1;
        if (row < 1 || row > frets) continue; // 超出显示范围
        const y = top + (row - 0.5) * fh;
        ctx.fillStyle = "#4da3ff";
        ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  return { LIB, parse, isChordToken, transposeToken, renderTextHtml, collectFrom, draw };
})();
