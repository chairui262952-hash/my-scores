/* 我的谱架 — 节拍器（Web Audio，原创实现） */
"use strict";

var Metronome = (() => {
  let ctx = null;
  let timer = null;
  let nextBeatTime = 0;
  let beatIndex = 0;
  let running = false;

  let bpm = 80;
  let beatsPerBar = 4;

  function tickSound(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  function schedule() {
    const ahead = 0.12; // 提前调度窗口（秒）
    while (nextBeatTime < ctx.currentTime + ahead) {
      tickSound(nextBeatTime, beatIndex % beatsPerBar === 0);
      beatIndex++;
      nextBeatTime += 60 / bpm;
    }
  }

  return {
    setBPM(v) { bpm = Math.min(240, Math.max(30, v)); },
    setBeats(v) { beatsPerBar = v; },
    isRunning: () => running,
    start() {
      if (running) return;
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      running = true;
      beatIndex = 0;
      nextBeatTime = ctx.currentTime + 0.06;
      timer = setInterval(schedule, 40);
    },
    stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
    },
    toggle() { running ? this.stop() : this.start(); return running; },
  };
})();
