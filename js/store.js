/* 端末内保存（IndexedDB）と画像アセット管理。外部への送信は行わない */
(function () {
  'use strict';
  const ND = (window.ND = window.ND || {});
  const U = ND.util;

  const DB_NAME = 'naildesigner';
  const DB_VER = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then((db) => {
      if (!db) throw new Error('no-idb');
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const idb = {
    available: () => openDB().then((d) => !!d),
    getProject: () => tx('kv', 'readonly', (s) => reqP(s.get('project'))),
    putProject: (json) => tx('kv', 'readwrite', (s) => { s.put(json, 'project'); }),
    clearProject: () => tx('kv', 'readwrite', (s) => { s.delete('project'); }),
    getAsset: (id) => tx('assets', 'readonly', (s) => reqP(s.get(id))),
    putAsset: (id, blob) => tx('assets', 'readwrite', (s) => { s.put(blob, id); }),
    assetKeys: () => tx('assets', 'readonly', (s) => reqP(s.getAllKeys())),
    deleteAsset: (id) => tx('assets', 'readwrite', (s) => { s.delete(id); }),
  };

  /* アセット：id → { blob, url, img, w, h } */
  const map = new Map();

  function decode(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ url, img });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  async function add(blob, id) {
    id = id || U.uid('a');
    const { url, img } = await decode(blob);
    map.set(id, { blob, url, img, w: img.naturalWidth, h: img.naturalHeight, saved: false });
    return id;
  }

  // 大きな画像を縮小してアセット化。座標はすべて縮小後の画像基準で保持する
  async function addImageFile(file, opts) {
    opts = opts || {};
    const maxSide = opts.maxSide || 2000;
    let decoded;
    try {
      decoded = await decode(file);
    } catch (e) {
      const err = new Error('unsupported');
      err.userMessage = 'この画像は読み込めませんでした。JPEG・PNG・HEIC（写真アプリから選択）の画像をお試しください。';
      throw err;
    }
    const { img, url } = decoded;
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) { URL.revokeObjectURL(url); throw Object.assign(new Error('empty'), { userMessage: '画像の大きさを読み取れませんでした。' }); }
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!opts.keepAlpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = opts.keepAlpha ? await U.canvasToBlob(c, 'image/png') : await U.canvasToBlob(c, 'image/jpeg', 0.92);
    const id = await add(blob);
    return { id, w, h, scaled: k < 1, origW: w0, origH: h0 };
  }

  async function addCanvas(canvas, type) {
    const blob = await U.canvasToBlob(canvas, type || 'image/png', 0.92);
    return add(blob);
  }

  function get(id) { return map.get(id) || null; }
  function img(id) { const a = map.get(id); return a ? a.img : null; }

  async function ensure(id) {
    if (map.has(id)) return true;
    try {
      const blob = await idb.getAsset(id);
      if (!blob) return false;
      await add(blob, id);
      map.get(id).saved = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function persist(ids) {
    for (const id of ids) {
      const a = map.get(id);
      if (a && !a.saved) {
        await idb.putAsset(id, a.blob);
        a.saved = true;
      }
    }
  }

  async function toDataURL(id) {
    const a = map.get(id);
    return a ? U.blobToDataURL(a.blob) : null;
  }

  ND.store = { idb, add, addImageFile, addCanvas, get, img, ensure, persist, toDataURL, map };
})();
