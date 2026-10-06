/* 我的谱架 — 本地数据库（IndexedDB） */
"use strict";

var DB = (() => {
  const NAME = "my-stand";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("scores")) {
          const s = db.createObjectStore("scores", { keyPath: "id" });
          s.createIndex("openedAt", "openedAt");
          s.createIndex("title", "title");
        }
        if (!db.objectStoreNames.contains("setlists")) {
          db.createObjectStore("setlists", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv", { keyPath: "k" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    // scores
    allScores: () => tx("scores", "readonly", s => s.getAll()),
    getScore: id => tx("scores", "readonly", s => s.get(id)),
    putScore: score => tx("scores", "readwrite", s => s.put(score)),
    delScore: id => tx("scores", "readwrite", s => s.delete(id)),
    // setlists
    allSetlists: () => tx("setlists", "readonly", s => s.getAll()),
    getSetlist: id => tx("setlists", "readonly", s => s.get(id)),
    putSetlist: list => tx("setlists", "readwrite", s => s.put(list)),
    delSetlist: id => tx("setlists", "readwrite", s => s.delete(id)),
    // kv
    getKV: async (k, dflt) => {
      const row = await tx("kv", "readonly", s => s.get(k));
      return row ? row.v : dflt;
    },
    setKV: (k, v) => tx("kv", "readwrite", s => s.put({ k, v })),

    uuid: () => (crypto.randomUUID ? crypto.randomUUID()
      : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)),
  };
})();
