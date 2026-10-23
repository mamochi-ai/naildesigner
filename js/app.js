/* 画面・操作・状態管理 */
(function () {
  'use strict';
  const ND = window.ND, U = ND.util, S = ND.store, M = ND.materials, R = ND.render;
  const $ = (id) => document.getElementById(id);
  const FINGERS = U.FINGERS;
  const fname = (id) => (FINGERS.find((f) => f.id === id) || {}).name || id;

  /* ================= 状態 ================= */
  function emptyNail() {
    return { skip: false, shape: { points: [], base: null, tip: null, smooth: 0.6, guessed: false }, design: null };
  }
  function emptyState() {
    const nails = {};
    FINGERS.forEach((f) => (nails[f.id] = emptyNail()));
    return { v: 1, photo: null, nails, cutouts: [], materials: [], refDraft: null, memo: '' };
  }
  let state = emptyState();

  // 編集状態（履歴に含めない表示上の状態）
  const ui = {
    tab: 'contour', finger: 'index', tool: 'edit', place: 'point', selPt: -1, selDeco: -1,
    compare: false, guides: true, pendingCut: null, allTargets: {},
    views: { photo: { zoom: 1, cx: 0, cy: 0 }, ref: { zoom: 1, cx: 0, cy: 0 } },
    saveStatus: '', lastSaved: null, idbOK: true,
  };

  /* ================= 履歴（元に戻す／やり直す） ================= */
  const hist = { past: [], future: [], last: null };
  function commit() {
    const s = JSON.stringify(state);
    if (s === hist.last) return;
    if (hist.last !== null) hist.past.push(hist.last);
    if (hist.past.length > 100) hist.past.shift();
    hist.last = s;
    hist.future = [];
    updateUndoButtons();
    renderFingers();
    scheduleSave();
  }
  function resetHistory() {
    hist.past = []; hist.future = []; hist.last = JSON.stringify(state);
    updateUndoButtons();
  }
  async function undo() {
    const cur = JSON.stringify(state);
    if (cur !== hist.last) {
      state = JSON.parse(hist.last);
    } else {
      if (!hist.past.length) return;
      hist.future.push(hist.last);
      hist.last = hist.past.pop();
      state = JSON.parse(hist.last);
    }
    await afterStateReplace();
    toast('元に戻しました');
  }
  async function redo() {
    if (!hist.future.length) return;
    hist.past.push(hist.last);
    hist.last = hist.future.pop();
    state = JSON.parse(hist.last);
    await afterStateReplace();
    toast('やり直しました');
  }
  function updateUndoButtons() {
    $('btnUndo').disabled = !hist.past.length && JSON.stringify(state) === hist.last;
    $('btnRedo').disabled = !hist.future.length;
  }

  async function afterStateReplace() {
    await ensureAssets();
    buildPhotoCanvas();
    buildRefCanvas();
    if (ui.selPt >= (target() ? target().shape.points.length : 0)) ui.selPt = -1;
    const d = state.nails[ui.finger].design;
    if (!d || ui.selDeco >= d.decos.length) ui.selDeco = -1;
    if (ui.pendingCut && !state.cutouts.find((c) => c.id === ui.pendingCut)) ui.pendingCut = null;
    updateUndoButtons();
    if (!state.photo) { showStart(); renderAll(); return; }
    hideStart();
    renderAll();
    scheduleSave();
  }

  function referencedAssets(st) {
    st = st || state;
    const ids = [];
    if (st.photo) ids.push(st.photo.assetId);
    if (st.refDraft) ids.push(st.refDraft.assetId);
    st.cutouts.forEach((c) => { ids.push(c.assetId); if (c.srcAssetId) ids.push(c.srcAssetId); });
    st.materials.forEach((m) => ids.push(m.assetId));
    return ids.filter(Boolean);
  }
  async function ensureAssets() {
    const missing = [];
    for (const id of referencedAssets()) if (!(await S.ensure(id))) missing.push(id);
    return missing;
  }

  /* ================= 画像キャンバス ================= */
  let photoCanvas = null, photoCanvasId = null, refCanvas = null, refCanvasId = null;
  function buildPhotoCanvas() {
    if (!state.photo) { photoCanvas = null; photoCanvasId = null; return; }
    if (photoCanvasId === state.photo.assetId && photoCanvas) return;
    const img = S.img(state.photo.assetId);
    if (!img) { photoCanvas = null; return; }
    photoCanvas = U.makeCanvas(state.photo.w, state.photo.h);
    photoCanvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, state.photo.w, state.photo.h);
    photoCanvasId = state.photo.assetId;
    R.clearCaches();
    compDirty = true;
  }
  function buildRefCanvas() {
    if (!state.refDraft) { refCanvas = null; refCanvasId = null; return; }
    if (refCanvasId === state.refDraft.assetId && refCanvas) return;
    const img = S.img(state.refDraft.assetId);
    if (!img) { refCanvas = null; return; }
    refCanvas = U.makeCanvas(state.refDraft.w, state.refDraft.h);
    refCanvas.getContext('2d').drawImage(img, 0, 0, state.refDraft.w, state.refDraft.h);
    refCanvasId = state.refDraft.assetId;
  }
  function env() {
    return {
      photo: photoCanvas,
      photoId: photoCanvasId,
      cutoutImg(id) {
        const c = state.cutouts.find((x) => x.id === id);
        const a = c && S.get(c.assetId);
        return a ? { img: a.img, w: a.w, h: a.h } : null;
      },
      assetImg(id) { const a = S.get(id); return a ? { img: a.img, w: a.w, h: a.h } : null; },
    };
  }

  /* ================= 編集対象 ================= */
  const refMode = () => ui.tab === 'photo' && !!state.refDraft && !!refCanvas;
  const editingContour = () => ui.tab === 'contour' || refMode();
  function target() {
    if (refMode()) return { kind: 'ref', shape: state.refDraft.shape };
    if (!state.photo) return null;
    return { kind: 'nail', shape: state.nails[ui.finger].shape };
  }
  function viewKey() { return refMode() ? 'ref' : 'photo'; }
  function srcSize() {
    if (refMode()) return { w: state.refDraft.w, h: state.refDraft.h };
    return state.photo ? { w: state.photo.w, h: state.photo.h } : { w: 1, h: 1 };
  }

  /* ================= ステージ描画 ================= */
  const stage = $('stage'), cv = $('stageCanvas'), loupe = $('loupe');
  let compDirty = true, comp = null, drawQueued = false;
  function markDirty() { compDirty = true; requestDraw(); }
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  function stageSize() { return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 }; }
  function viewXf() {
    const v = ui.views[viewKey()], s = srcSize(), st = stageSize();
    const fit = Math.min(st.w / s.w, st.h / s.h) * 0.94;
    const scale = fit * v.zoom;
    return { scale, tx: st.w / 2 - v.cx * scale, ty: st.h / 2 - v.cy * scale, fit };
  }
  const toScreen = (p, X) => ({ x: p.x * X.scale + X.tx, y: p.y * X.scale + X.ty });
  const toImage = (p, X) => ({ x: (p.x - X.tx) / X.scale, y: (p.y - X.ty) / X.scale });
  function fitView(key) {
    const s = key === 'ref' && state.refDraft ? { w: state.refDraft.w, h: state.refDraft.h }
      : state.photo ? { w: state.photo.w, h: state.photo.h } : { w: 1, h: 1 };
    ui.views[key] = { zoom: 1, cx: s.w / 2, cy: s.h / 2 };
  }

  function currentSource() {
    if (refMode()) return refCanvas;
    if (!photoCanvas) return null;
    if (ui.compare) return photoCanvas;
    if (compDirty || !comp) { comp = R.composite(state, env()); compDirty = false; }
    return comp;
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const st = stageSize();
    const W = Math.round(st.w * dpr), H = Math.round(st.h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const src = currentSource();
    if (!src) return;
    const X = viewXf();
    ctx.setTransform(dpr * X.scale, 0, 0, dpr * X.scale, dpr * X.tx, dpr * X.ty);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, X);
    updateStageText();
  }

  function strokeShape(ctx, pts, closed, outer, inner, wo, wi, dash) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (closed) ctx.closePath();
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outer; ctx.lineWidth = wo; ctx.stroke();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = inner; ctx.lineWidth = wi; ctx.stroke();
    ctx.setLineDash([]);
  }
  let fontCache = null;
  function uiFont() { return fontCache || (fontCache = getComputedStyle(document.body).fontFamily); }
  function pill(ctx, text, x, y, bg, fg) {
    ctx.font = '600 12px ' + uiFont();
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 11, w, 22, 11); else ctx.rect(x - w / 2, y - 11, w, 22);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function marker(ctx, p, label, bg) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px ' + uiFont();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label[0], p.x, p.y + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawShapeEditor(ctx, X, shape) {
    const sp = shape.points.map((p) => toScreen(p, X));
    if (shape.points.length >= 3) {
      const sm = U.smoothContour(shape.points, shape.smooth, 8).map((p) => toScreen(p, X));
      strokeShape(ctx, sm, true, 'rgba(255,255,255,0.95)', '#d6336c', 4.5, 2);
      strokeShape(ctx, sp, true, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.55)', 0, 1, [3, 4]);
    } else if (sp.length) {
      strokeShape(ctx, sp, false, 'rgba(255,255,255,0.95)', '#d6336c', 4, 2, [5, 4]);
    }
    const f = U.nailFrame(shape);
    if (f) {
      const b = toScreen(shape.base || f.base, X), t = toScreen(shape.tip || f.tip, X);
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(t.y - b.y, t.x - b.x);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(t.x - Math.cos(ang) * 14, t.y - Math.sin(ang) * 14);
      ctx.lineTo(t.x - Math.cos(ang - 0.45) * 26, t.y - Math.sin(ang - 0.45) * 26);
      ctx.lineTo(t.x - Math.cos(ang + 0.45) * 26, t.y - Math.sin(ang + 0.45) * 26);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      marker(ctx, b, '根元', '#4a5d73');
      marker(ctx, t, '先端', '#d6336c');
      pill(ctx, '根元', b.x, b.y + 26, 'rgba(74,93,115,0.92)', '#fff');
      pill(ctx, '先端', t.x, t.y - 26, 'rgba(214,51,108,0.92)', '#fff');
    } else {
      if (shape.base) marker(ctx, toScreen(shape.base, X), '根元', '#4a5d73');
      if (shape.tip) marker(ctx, toScreen(shape.tip, X), '先端', '#d6336c');
    }
    sp.forEach((p, i) => {
      const sel = i === ui.selPt;
      ctx.beginPath(); ctx.arc(p.x, p.y, sel ? 10 : 7, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#d6336c' : '#fff'; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = sel ? '#fff' : '#d6336c'; ctx.stroke();
    });
  }

  function drawOverlay(ctx, X) {
    if (refMode()) { drawShapeEditor(ctx, X, state.refDraft.shape); drawDrag(ctx); return; }
    const editing = ui.tab === 'contour';
    FINGERS.forEach((F) => {
      const n = state.nails[F.id];
      const sel = F.id === ui.finger;
      if (!ui.guides && !(sel && editing)) return;
      if (!n.shape.points.length) return;
      if (sel && editing) return; // 編集中の指は後で描く
      const f = U.nailFrame(n.shape);
      if (f) {
        const sm = f.contour.map((p) => toScreen(p, X));
        if (sel) strokeShape(ctx, sm, true, 'rgba(255,255,255,0.9)', '#d6336c', 4, 2);
        else if (!n.skip) strokeShape(ctx, sm, true, 'rgba(40,30,32,0.45)', 'rgba(255,255,255,0.9)', 3, 1.2, [4, 4]);
        const lp = toScreen({ x: f.C.x - f.v.x * (f.H / 2), y: f.C.y - f.v.y * (f.H / 2) }, X);
        pill(ctx, F.name + (n.skip ? '（スキップ）' : ''), lp.x, lp.y + 18,
          sel ? 'rgba(214,51,108,0.92)' : 'rgba(58,46,49,0.7)', '#fff');
      }
    });
    if (editing && state.photo) {
      const n = state.nails[ui.finger];
      drawShapeEditor(ctx, X, n.shape);
    }
    drawDrag(ctx);
  }

  function drawDrag(ctx) {
    if (gesture && gesture.type === 'place' && gesture.cur) {
      const p = gesture.cur;
      ctx.strokeStyle = '#d6336c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function updateStageText() {
    const hint = $('stageHint'), badge = $('stageBadge');
    let msg = '';
    if (editingContour() && ui.guides !== false) {
      const t = target();
      const sh = t && t.shape;
      const who = refMode() ? '参考画像の爪' : fname(ui.finger) + 'の爪';
      if (ui.tool === 'pan') msg = '1本指で写真を動かせます（点を置くには「点を編集」）';
      else if (ui.place === 'base') msg = '根元（甘皮側）の位置をタップしてください';
      else if (ui.place === 'tip') msg = '先端の位置をタップしてください';
      else if (sh && sh.points.length < 3) msg = who + 'のふちをタップして点を置きます（目安6〜12点）';
      else if (sh && sh.guessed) msg = '根元・先端を仮置きしました。違う場合は「向きを反転」か印をドラッグ';
    }
    hint.hidden = !msg;
    hint.textContent = msg;
    let b = '';
    if (refMode()) b = '参考画像を編集中';
    else if (ui.compare) b = '変更前（元の写真）';
    else if (state.photo && state.photo.demo) b = '図解デモ（実写ではありません）';
    badge.hidden = !b;
    badge.textContent = b;
  }

  /* ================= ルーペ（指で点が隠れる対策） ================= */
  function showLoupe(screenPt, imgPt) {
    const src = currentSource();
    if (!src) return;
    const st = stageSize();
    loupe.hidden = false;
    const left = screenPt.x < st.w / 2 && screenPt.y < 190;
    loupe.style.left = left ? 'auto' : '12px';
    loupe.style.right = left ? '12px' : 'auto';
    const X = viewXf();
    const mag = Math.max(X.scale * 2.5, 0.8);
    const ls = mag * 2; // ルーペキャンバスは2倍解像度
    const lc = loupe.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.fillStyle = '#ebe5dd';
    lc.fillRect(0, 0, 300, 300);
    lc.setTransform(ls, 0, 0, ls, 150 - imgPt.x * ls, 150 - imgPt.y * ls);
    lc.drawImage(src, 0, 0);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    const t = target();
    if (t) {
      const map = (p) => ({ x: 150 + (p.x - imgPt.x) * ls, y: 150 + (p.y - imgPt.y) * ls });
      const pts = t.shape.points.length >= 3 ? U.smoothContour(t.shape.points, t.shape.smooth, 8) : t.shape.points;
      if (pts.length) {
        lc.beginPath();
        pts.map(map).forEach((p, i) => (i ? lc.lineTo(p.x, p.y) : lc.moveTo(p.x, p.y)));
        if (pts.length >= 3) lc.closePath();
        lc.strokeStyle = '#d6336c'; lc.lineWidth = 2; lc.stroke();
      }
      t.shape.points.map(map).forEach((p) => { lc.beginPath(); lc.arc(p.x, p.y, 5, 0, 7); lc.fillStyle = '#fff'; lc.fill(); });
    }
    lc.strokeStyle = 'rgba(0,0,0,0.6)'; lc.lineWidth = 3;
    lc.beginPath(); lc.moveTo(150, 120); lc.lineTo(150, 180); lc.moveTo(120, 150); lc.lineTo(180, 150); lc.stroke();
    lc.strokeStyle = '#fff'; lc.lineWidth = 1.2;
    lc.beginPath(); lc.moveTo(150, 120); lc.lineTo(150, 180); lc.moveTo(120, 150); lc.lineTo(180, 150); lc.stroke();
  }
  function hideLoupe() { loupe.hidden = true; }

  /* ================= タッチ操作 =================
     2本指 = 常に写真の拡大・移動（輪郭は変わらない）
     1本指 = 「点を編集」中のみ点の追加・移動。それ以外は写真の移動 */
  const pointers = new Map();
  let gesture = null;
  function localPt(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function hitHandle(sp, X) {
    const t = target();
    if (!t) return null;
    const sh = t.shape;
    const f = U.nailFrame(sh);
    const cand = [];
    sh.points.forEach((p, i) => cand.push({ kind: 'pt', i, p }));
    if (f) { cand.push({ kind: 'base', p: sh.base || f.base }); cand.push({ kind: 'tip', p: sh.tip || f.tip }); }
    let best = null, bd = 18;
    cand.forEach((c) => {
      const d = U.dist(toScreen(c.p, X), sp);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== cv) return;
    if (!currentSource()) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    const p = localPt(e);
    pointers.set(e.pointerId, p);
    const X = viewXf();
    if (pointers.size === 2) {
      cancelSingle();
      const [a, b] = [...pointers.values()];
      const v = ui.views[viewKey()];
      gesture = { type: 'pinch', d0: U.dist(a, b) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom0: v.zoom, X0: X };
      return;
    }
    if (pointers.size > 2) return;
    const start = { s: p, t: performance.now() };
    if (editingContour() && ui.tool === 'edit') {
      const h = ui.place === 'point' ? hitHandle(p, X) : null;
      if (h) {
        const sh = target().shape;
        gesture = Object.assign(start, { type: 'drag', h, orig: U.clone(h.p), before: JSON.stringify(sh), moved: false });
        if (h.kind === 'pt') { ui.selPt = h.i; renderPanelSoft(); }
        showLoupe(p, h.p);
      } else {
        gesture = Object.assign(start, { type: 'place', cur: p });
        showLoupe(p, toImage(p, X));
      }
    } else {
      const v = ui.views[viewKey()];
      gesture = Object.assign(start, { type: 'pan', cx0: v.cx, cy0: v.cy, moved: false });
    }
    requestDraw();
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = localPt(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    const X = viewXf();
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = U.dist(a, b) || 1;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = ui.views[viewKey()];
      const anchor = toImage(gesture.m0, gesture.X0);
      v.zoom = U.clamp((gesture.zoom0 * d) / gesture.d0, 0.5, 14);
      const st = stageSize();
      const sc = X.fit * v.zoom;
      v.cx = anchor.x - (m.x - st.w / 2) / sc;
      v.cy = anchor.y - (m.y - st.h / 2) / sc;
      requestDraw();
    } else if (gesture.type === 'pan') {
      const v = ui.views[viewKey()];
      if (U.dist(p, gesture.s) > 6) gesture.moved = true;
      v.cx = gesture.cx0 - (p.x - gesture.s.x) / X.scale;
      v.cy = gesture.cy0 - (p.y - gesture.s.y) / X.scale;
      requestDraw();
    } else if (gesture.type === 'drag') {
      // 指の移動量だけ点を動かす（指の真下に点が来ないので見やすい）
      const dx = (p.x - gesture.s.x) / X.scale, dy = (p.y - gesture.s.y) / X.scale;
      if (U.dist(p, gesture.s) > 3) gesture.moved = true;
      const np = { x: gesture.orig.x + dx, y: gesture.orig.y + dy };
      const sh = target().shape;
      if (gesture.h.kind === 'pt') sh.points[gesture.h.i] = np;
      else {
        if (!sh.base || !sh.tip) { const f = U.nailFrame(sh); sh.base = sh.base || f.base; sh.tip = sh.tip || f.tip; }
        sh[gesture.h.kind] = np;
        sh.guessed = false;
      }
      showLoupe(p, np);
      markDirty();
    } else if (gesture.type === 'place') {
      gesture.cur = p;
      showLoupe(p, toImage(p, X));
      requestDraw();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      else gesture = { type: 'none' }; // 残った指は離すまで無視
      return;
    }
    if (pointers.size) return;
    const g = gesture;
    gesture = null;
    hideLoupe();
    if (e.type === 'pointercancel') { cancelSingleFrom(g); requestDraw(); return; }
    const X = viewXf();
    if (g.type === 'place') {
      addAt(toImage(g.cur, X));
    } else if (g.type === 'drag') {
      if (g.moved) { commit(); renderPanelSoft(); }
      requestDraw();
    } else if (g.type === 'pan') {
      if (!g.moved && performance.now() - g.t < 500 && !refMode()) tapSelect(toImage(g.s, X));
    }
    requestDraw();
  }
  function cancelSingleFrom(g) {
    if (g && g.type === 'drag') {
      const sh = target().shape;
      Object.assign(sh, JSON.parse(g.before));
      markDirty();
    }
  }
  function cancelSingle() {
    if (gesture && gesture.type !== 'pinch') { cancelSingleFrom(gesture); gesture = null; hideLoupe(); }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) endPointer(e); });
  stage.addEventListener('wheel', (e) => {
    if (!currentSource()) return;
    e.preventDefault();
    zoomAt(localPt(e), Math.exp(-e.deltaY * 0.0018));
  }, { passive: false });
  ['gesturestart', 'gesturechange'].forEach((n) => stage.addEventListener(n, (e) => e.preventDefault()));

  function zoomAt(sp, k) {
    const X = viewXf();
    const anchor = toImage(sp, X);
    const v = ui.views[viewKey()];
    v.zoom = U.clamp(v.zoom * k, 0.5, 14);
    const st = stageSize();
    const sc = X.fit * v.zoom;
    v.cx = anchor.x - (sp.x - st.w / 2) / sc;
    v.cy = anchor.y - (sp.y - st.h / 2) / sc;
    requestDraw();
  }

  function addAt(p) {
    const t = target();
    if (!t) return;
    const s = srcSize();
    if (p.x < 0 || p.y < 0 || p.x > s.w || p.y > s.h) { toast('写真の外には置けません'); return; }
    const sh = t.shape;
    if (ui.place === 'base' || ui.place === 'tip') {
      sh[ui.place] = p;
      if (!sh.base || !sh.tip) { const g = sh.points.length >= 3 ? U.guessAxis(sh.points) : null; if (g) { sh.base = sh.base || g.base; sh.tip = sh.tip || g.tip; } }
      sh.guessed = false;
      toast((ui.place === 'base' ? '根元' : '先端') + 'を置きました');
      ui.place = 'point';
    } else {
      if (t.kind === 'nail' && state.nails[ui.finger].skip) state.nails[ui.finger].skip = false;
      const i = U.insertIndex(sh.points, p);
      sh.points.splice(i, 0, p);
      ui.selPt = i;
      if (sh.points.length >= 3 && (!sh.base || !sh.tip)) {
        const g = U.guessAxis(sh.points);
        sh.base = g.base; sh.tip = g.tip; sh.guessed = true;
      }
    }
    commit();
    markDirty();
    renderPanelSoft();
  }

  function tapSelect(p) {
    for (const F of FINGERS) {
      const f = U.nailFrame(state.nails[F.id].shape);
      if (f && U.pointInPoly(p, f.contour)) {
        if (F.id !== ui.finger) selectFinger(F.id);
        return;
      }
    }
  }

  /* ================= UI 部品 ================= */
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'style') el.style.cssText = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  const btn = (label, onclick, cls, attrs) => h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, attrs || {}), label);
  let sliderSeq = 0;
  function slider(label, value, min, max, step, fmt, onInput) {
    const id = 'sl' + ++sliderSeq;
    const out = h('output', { for: id, text: fmt(value) });
    const inp = h('input', { type: 'range', id, min, max, step, value });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput(v); markDirty(); });
    inp.addEventListener('change', () => commit());
    return h('div', { class: 'slider' }, [h('label', { for: id, text: label }), inp, out]);
  }
  const pct = (v) => Math.round(v * 100) + '%';
  function group(title, kids) { return h('div', { class: 'group' }, [title ? h('h3', { text: title }) : null].concat(kids)); }
  function note(text, warn) { return h('p', { class: 'note' + (warn ? ' warn' : ''), text }); }

  function swatches(current, onPick, opts) {
    opts = opts || {};
    const wrap = h('div', { class: 'swatches' });
    if (opts.allowNone) {
      wrap.appendChild(h('button', { type: 'button', class: 'swatch none', 'aria-pressed': current == null ? 'true' : 'false', 'aria-label': '塗らない', onclick: () => onPick(null) }, 'なし'));
    }
    (opts.colors || M.COLORS).forEach((c) => {
      wrap.appendChild(h('button', {
        type: 'button', class: 'swatch', style: 'background:' + c, 'aria-label': c,
        'aria-pressed': current && current.toLowerCase() === c ? 'true' : 'false', onclick: () => onPick(c),
      }));
    });
    return wrap;
  }
  function colorPicker(current, onPick, label) {
    const id = 'cp' + ++sliderSeq;
    const inp = h('input', { type: 'color', id, value: current || '#e8a3ad' });
    inp.addEventListener('input', () => { onPick(inp.value, true); markDirty(); });
    inp.addEventListener('change', () => { onPick(inp.value, false); commit(); renderPanel(); });
    return h('div', { class: 'color-row' }, [inp, h('label', { for: id, class: 'note', text: label || 'カラーピッカーで細かく選ぶ' })]);
  }

  function editingLabel() {
    return h('p', { class: 'editing-label' }, ['編集中の指：', h('b', { text: fname(ui.finger) })]);
  }

  /* ================= 指の選択 ================= */
  function fingerStatus(n) {
    if (n.skip) return 'スキップ';
    if (n.shape.points.length < 3) return n.shape.points.length ? '点 ' + n.shape.points.length : '未設定';
    if (n.design) return n.design.art && n.design.art.kind === 'cutout' ? '写真柄' : 'デザイン';
    return '輪郭のみ';
  }
  function renderFingers() {
    const bar = $('fingerBar');
    bar.hidden = refMode();
    bar.innerHTML = '';
    FINGERS.forEach((F) => {
      const n = state.nails[F.id];
      bar.appendChild(h('button', {
        type: 'button', class: 'finger-btn' + (n.skip ? ' skip' : ''), 'aria-pressed': F.id === ui.finger ? 'true' : 'false',
        onclick: () => selectFinger(F.id),
      }, [h('span', { class: 'nm', text: F.name }), h('span', { class: 'st', text: fingerStatus(n) })]));
    });
  }
  function selectFinger(id) {
    ui.finger = id; ui.selPt = -1; ui.selDeco = -1; ui.place = 'point';
    renderFingers(); renderPanel(); requestDraw();
  }

  /* ================= パネル ================= */
  const panel = $('panel');
  function renderAll() { renderTabs(); renderFingers(); renderPanel(); markDirty(); }
  function renderTabs() {
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false');
    });
    const showTools = editingContour();
    document.querySelector('.stage-tools .seg').hidden = !showTools;
    $('toolEdit').setAttribute('aria-pressed', ui.tool === 'edit' ? 'true' : 'false');
    $('toolPan').setAttribute('aria-pressed', ui.tool === 'pan' ? 'true' : 'false');
    $('zoomNail').hidden = refMode();
  }
  function setTab(t) {
    ui.tab = t; ui.selPt = -1; ui.place = 'point'; ui.compare = false;
    syncCompare();
    renderAll();
  }
  let softTimer = null;
  function renderPanelSoft() { clearTimeout(softTimer); softTimer = setTimeout(renderPanel, 0); }
  function renderPanel() {
    const scroll = panel.scrollTop;
    panel.innerHTML = '';
    if (!state.photo) return;
    const map = { contour: panelContour, photo: panelPhoto, design: panelDesign, custom: panelCustom, export: panelExport };
    (map[ui.tab] || panelContour)();
    renderTabs();
    panel.scrollTop = scroll;
    $('fingerBar').hidden = refMode();
  }

  // 輪郭の操作部品（手の写真・参考画像で共通）
  function contourControls(shape, isRef) {
    const n = shape.points.length;
    const cnt = h('span', { class: 'count ' + (n >= 6 && n <= 12 ? 'ok' : 'low'), text: n + '点' });
    const kids = [];
    kids.push(h('div', { class: 'row' }, [h('span', { class: 'note' }, ['点の数：', cnt, '（目安 6〜12点）'])]));
    kids.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'タップで置くもの' }, [
      ['point', '輪郭の点'], ['base', '根元を置く'], ['tip', '先端を置く'],
    ].map(([k, l]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': ui.place === k ? 'true' : 'false',
      onclick: () => { ui.place = k; ui.tool = 'edit'; renderPanel(); requestDraw(); },
    }, l))));
    kids.push(slider('なめらかさ', shape.smooth, 0, 1, 0.05, pct, (v) => { shape.smooth = v; }));
    kids.push(h('div', { class: 'row' }, [
      btn('選んだ点を削除', () => {
        if (ui.selPt < 0) return;
        shape.points.splice(ui.selPt, 1); ui.selPt = -1;
        if (shape.points.length < 3) { shape.base = null; shape.tip = null; }
        commit(); markDirty(); renderPanel();
      }, '', { disabled: ui.selPt < 0 }),
      btn('最後に置いた点を消す', () => {
        if (!shape.points.length) return;
        shape.points.splice(ui.selPt >= 0 ? ui.selPt : shape.points.length - 1, 1);
        ui.selPt = -1;
        if (shape.points.length < 3) { shape.base = null; shape.tip = null; }
        commit(); markDirty(); renderPanel();
      }, '', { disabled: !n }),
    ]));
    kids.push(h('div', { class: 'row' }, [
      btn('向きを反転', () => {
        const f = U.nailFrame(shape); if (!f) return;
        const b = shape.base || f.base, t = shape.tip || f.tip;
        shape.base = t; shape.tip = b; shape.guessed = false;
        commit(); markDirty(); renderPanel();
      }, '', { disabled: n < 3 }),
      btn('輪郭をやり直す', async () => {
        if (!(await confirmDialog('輪郭を消しますか？', (isRef ? '参考画像' : fname(ui.finger)) + 'の点と根元・先端をすべて消します。「戻す」で元に戻せます。', '消す', true))) return;
        shape.points = []; shape.base = null; shape.tip = null; shape.guessed = false; ui.selPt = -1;
        commit(); markDirty(); renderPanel();
      }, 'danger', { disabled: !n && !shape.base }),
    ]));
    kids.push(note('点をタップすると選択、ドラッグで移動します。指で隠れる部分は左上の拡大鏡で確認できます。2本指の操作は写真の拡大・移動だけで、輪郭は動きません。'));
    return kids;
  }

  function panelContour() {
    const n = state.nails[ui.finger];
    panel.appendChild(h('div', { class: 'steps' }, [h('span', { text: '1 写真' }), h('span', { text: '2 輪郭 ← いまここ' }), h('span', { text: '3 色・柄' }), h('span', { text: '4 保存' })]));
    panel.appendChild(h('h2', { text: fname(ui.finger) + 'の爪の輪郭' }));
    if (n.skip) {
      panel.appendChild(group(null, [note('この指はスキップ中です。合成と相談用シートから外れます。'),
        btn('スキップを解除', () => { n.skip = false; commit(); markDirty(); renderPanel(); }, 'primary')]));
      return;
    }
    panel.appendChild(group('点を置く', contourControls(n.shape, false)));
    panel.appendChild(h('div', { class: 'row' }, [btn('爪が見えにくい？ 撮り方ガイド', openGuide, 'ghost')]));
    panel.appendChild(h('div', { class: 'row' }, [
      btn('この指はスキップ', () => { n.skip = true; commit(); markDirty(); renderPanel(); }),
      btn('次の指へ', () => {
        const i = FINGERS.findIndex((f) => f.id === ui.finger);
        selectFinger(FINGERS[(i + 1) % FINGERS.length].id);
      }, 'primary'),
    ]));
    const ready = FINGERS.filter((F) => state.nails[F.id].shape.points.length >= 3 && !state.nails[F.id].skip).length;
    if (ready) {
      panel.appendChild(group(null, [
        note('輪郭ができた爪：' + ready + '本。色や柄は下の「写真から」「デザイン」「自分で作る」で付けられます。'),
        btn('単色をすぐ試す（自分で作る）', () => { if (n.shape.points.length >= 3) ensureDesign(ui.finger); commit(); setTab('custom'); }),
      ]));
    }
  }

  function needContour() {
    const n = state.nails[ui.finger];
    if (n.skip) {
      panel.appendChild(group(null, [note(fname(ui.finger) + 'はスキップ中です。'), btn('スキップを解除', () => { n.skip = false; commit(); markDirty(); renderPanel(); })]));
      return true;
    }
    if (n.shape.points.length < 3) {
      panel.appendChild(group(null, [note(fname(ui.finger) + 'の輪郭がまだありません。先に輪郭を作ってください。', true),
        btn('輪郭を作る', () => setTab('contour'), 'primary')]));
      return true;
    }
    return false;
  }
  function ensureDesign(fid) {
    const n = state.nails[fid];
    if (!n.design) n.design = M.defaultDesign();
    return n.design;
  }
  function fingersWithContour() {
    return FINGERS.filter((F) => !state.nails[F.id].skip && state.nails[F.id].shape.points.length >= 3).map((F) => F.id);
  }

  /* --- 位置・大きさの調整（写真柄・素材・柄で共通） --- */
  function tfControls(d, showFit) {
    const t = d.tf;
    const kids = [];
    if (showFit) {
      kids.push(h('div', { class: 'chips', role: 'group', 'aria-label': '合わせ方' }, [
        ['clip', 'A 比率を保って爪で切る'], ['stretch', 'B 爪の長さ・幅に合わせる'],
      ].map(([k, l]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': t.fit === k ? 'true' : 'false',
        onclick: () => { t.fit = k; commit(); markDirty(); renderPanel(); },
      }, l))));
    }
    kids.push(slider('位置（横）', t.x, -0.6, 0.6, 0.01, (v) => Math.round(v * 100), (v) => (t.x = v)));
    kids.push(slider('位置（縦）', t.y, -0.6, 0.6, 0.01, (v) => Math.round(v * 100), (v) => (t.y = v)));
    kids.push(slider('回転', t.rot, -180, 180, 1, (v) => Math.round(v) + '°', (v) => (t.rot = v)));
    kids.push(slider('大きさ', t.scale, 0.3, 3, 0.01, pct, (v) => (t.scale = v)));
    kids.push(slider('縦横比', t.aspect, 0.5, 2, 0.01, (v) => v.toFixed(2), (v) => (t.aspect = v)));
    kids.push(slider('柄の濃さ', d.artOpacity == null ? 1 : d.artOpacity, 0, 1, 0.01, pct, (v) => (d.artOpacity = v)));
    kids.push(h('div', { class: 'row' }, [
      btn(t.flip ? '左右反転：オン' : '左右反転：オフ', () => { t.flip = !t.flip; commit(); markDirty(); renderPanel(); }, '', { 'aria-pressed': t.flip ? 'true' : 'false' }),
      btn('位置をリセット', () => { d.tf = Object.assign(M.defaultDesign().tf, { fit: t.fit }); commit(); markDirty(); renderPanel(); }),
    ]));
    return kids;
  }

  function copyTargets(onApply, label) {
    const ids = fingersWithContour().filter((id) => id !== ui.finger);
    if (!ids.length) return note('ほかの指にも適用するには、その指の輪郭を作ってください。');
    const sel = ui.allTargets;
    ids.forEach((id) => { if (sel[id] == null) sel[id] = true; });
    const chips = h('div', { class: 'chips' }, ids.map((id) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': sel[id] ? 'true' : 'false',
      onclick: (e) => { sel[id] = !sel[id]; e.currentTarget.setAttribute('aria-pressed', sel[id] ? 'true' : 'false'); },
    }, fname(id))));
    return group(label, [chips, btn('選んだ指に適用', () => {
      const chosen = ids.filter((id) => sel[id]);
      if (!chosen.length) { toast('指を選んでください'); return; }
      chosen.forEach(onApply);
      commit(); markDirty(); renderFingers();
      toast(chosen.map(fname).join('・') + 'に適用しました');
    }, 'primary')]);
  }

  /* --- ① 写真から --- */
  function panelPhoto() {
    if (state.refDraft) return panelRefEdit();
    panel.appendChild(editingLabel());
    panel.appendChild(group('参考画像から爪1本を切り抜く', [
      note('参考にしたいネイル写真を選び、爪1本の輪郭と根元・先端を指定して切り抜きます。'),
      h('div', { class: 'row' }, [
        btn('参考画像を選ぶ', () => $('fileRef').click(), 'primary'),
        btn('図解の参考画像で試す', loadDemoRef),
      ]),
    ]));
    if (state.cutouts.length) {
      const list = h('div', { class: 'thumbs' });
      state.cutouts.forEach((c, i) => {
        const a = S.get(c.assetId);
        const im = a ? h('img', { src: a.url, alt: '切り抜き ' + (i + 1) }) : h('span', { text: '読み込み中' });
        list.appendChild(h('button', {
          type: 'button', class: 'thumb', 'aria-pressed': ui.pendingCut === c.id ? 'true' : 'false',
          onclick: () => { ui.pendingCut = c.id; renderPanel(); },
        }, [im, h('span', { class: 'cap', text: c.name })]));
      });
      panel.appendChild(group('切り抜いた柄', [list, note('柄を選ぶと、この指に当てた見え方を比べられます。')]));
    }
    if (needContour()) return;
    const n = state.nails[ui.finger];
    if (ui.pendingCut) {
      const cut = state.cutouts.find((c) => c.id === ui.pendingCut);
      if (cut) panel.appendChild(cutoutCompare(n, cut));
    }
    if (n.design && n.design.art && n.design.art.kind === 'cutout') {
      panel.appendChild(group('位置・大きさの調整', tfControls(n.design, true)));
      panel.appendChild(copyTargets((id) => {
        const d = ensureDesign(id);
        d.art = U.clone(n.design.art); d.tf = U.clone(n.design.tf);
        d.artOpacity = n.design.artOpacity; d.shadeAmt = n.design.shadeAmt; d.gloss = n.design.gloss;
        d.color = n.design.color; d.presetId = null;
      }, 'この柄をほかの指にも適用'));
      panel.appendChild(note('元写真の反射・影・写り込みは柄と一緒に残ります（完全には除去できません）。そのため追加の光沢は0にしています。柄が足りない部分は元の爪が見えます。下地色は「自分で作る」で設定できます。'));
    }
  }

  function cutoutCompare(n, cut) {
    const e = env();
    const f = U.nailFrame(n.shape);
    const mk = (fit) => {
      const d = n.design ? U.clone(n.design) : M.defaultDesign();
      d.art = { kind: 'cutout', cutoutId: cut.id };
      d.tf = Object.assign(M.defaultDesign().tf, { fit });
      if (!n.design || !(n.design.art && n.design.art.kind === 'cutout')) { d.color = null; d.shadeAmt = 0.2; d.gloss = 0; d.french.on = false; d.glitter.on = false; }
      d.presetId = null;
      return d;
    };
    const cells = [];
    cells.push(h('div', { class: 'thumb' }, [R.closeup(photoCanvas, f, 160, 200, R.cachedLayer('__none', n.shape, null, e)), h('span', { class: 'cap', text: '元の爪' })]));
    ['clip', 'stretch'].forEach((fit) => {
      const d = mk(fit);
      const layer = R.nailLayer(n.shape, d, e, ui.finger);
      const active = n.design && n.design.art && n.design.art.cutoutId === cut.id && n.design.tf.fit === fit;
      cells.push(h('button', {
        type: 'button', class: 'thumb', 'aria-pressed': active ? 'true' : 'false',
        onclick: () => {
          n.design = d;
          commit(); markDirty(); renderPanel();
          toast(fname(ui.finger) + 'に適用しました（' + (fit === 'clip' ? 'A' : 'B') + '）');
        },
      }, [R.closeup(photoCanvas, f, 160, 200, layer), h('span', { class: 'cap', text: fit === 'clip' ? 'A 比率を保つ' : 'B 爪に合わせる' })]));
    });
    return group('適用前に見比べる', [h('div', { class: 'compare3' }, cells),
      note('A は柄の縦横比を保ち、はみ出した部分を爪の輪郭で切ります。B は柄全体を爪の長さ・幅に合わせて変形します。タップで適用します。')]);
  }

  function panelRefEdit() {
    const rd = state.refDraft;
    panel.appendChild(h('h2', { text: '参考画像の爪を切り抜く' }));
    panel.appendChild(note('手順：爪のふちに点を置く → 根元と先端を確認 → 「切り抜く」。隠れて見えない部分の模様は補完しません。'));
    panel.appendChild(group('点を置く', contourControls(rd.shape, true)));
    panel.appendChild(h('div', { class: 'row' }, [
      btn('やめる', async () => {
        if (rd.shape.points.length && !(await confirmDialog('切り抜きをやめますか？', '参考画像に置いた点は消えます。「戻す」で元に戻せます。', 'やめる', true))) return;
        state.refDraft = null; commit(); buildRefCanvas(); renderAll();
      }),
      btn('切り抜く', makeCutout, 'primary', { disabled: rd.shape.points.length < 3 }),
    ]));
    panel.appendChild(note('元写真の反射や影は、切り抜いた柄に残ります。完全には除去できません。'));
  }

  async function makeCutout() {
    const rd = state.refDraft;
    const f = U.nailFrame(rd.shape);
    if (!f || !refCanvas) return;
    const k = Math.min(1, 700 / Math.max(f.W, f.H));
    const w = Math.round(f.W * k), hh = Math.round(f.H * k);
    const c = U.makeCanvas(w, hh);
    const ctx = c.getContext('2d');
    const T = U.imageToUpright(f, k, w / 2, hh / 2);
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(refCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    U.pathFrom(ctx, f.contour);
    ctx.fill();
    const assetId = await S.addCanvas(c, 'image/png');
    const id = U.uid('cut');
    state.cutouts.push({ id, assetId, w, h: hh, srcAssetId: rd.assetId, shape: U.clone(rd.shape), name: '切り抜き' + (state.cutouts.length + 1) });
    state.refDraft = null;
    ui.pendingCut = id;
    commit();
    buildRefCanvas();
    renderAll();
    toast('切り抜きました。この指に当てて比べてください');
  }

  async function loadRefFile(file) {
    try {
      const r = await S.addImageFile(file, { maxSide: 2000 });
      state.refDraft = { assetId: r.id, w: r.w, h: r.h, shape: { points: [], base: null, tip: null, smooth: 0.6, guessed: false } };
      startRefEdit();
    } catch (e) { showError(e); }
  }
  async function loadDemoRef() {
    const d = ND.demo.reference();
    const id = await S.addCanvas(d.canvas, 'image/jpeg');
    state.refDraft = { assetId: id, w: d.canvas.width, h: d.canvas.height, demo: true, shape: d.shape };
    startRefEdit();
    toast('図解の参考画像に、例として輪郭を入れてあります。点は動かせます');
  }
  function startRefEdit() {
    ui.tab = 'photo'; ui.selPt = -1; ui.place = 'point'; ui.tool = 'edit';
    buildRefCanvas();
    fitView('ref');
    commit();
    renderAll();
  }

  /* --- ② デザインから選ぶ --- */
  const thumbCache = new Map();
  function presetThumb(key, design) {
    const k = key + JSON.stringify(design);
    if (thumbCache.has(k)) return thumbCache.get(k);
    const s = ND.demo.sampleFinger();
    const e = { photo: s.canvas, photoId: 'sample', cutoutImg: env().cutoutImg, assetImg: env().assetImg };
    const layer = R.nailLayer(s.shape, design, e, 'sample');
    const c = U.makeCanvas(s.canvas.width, s.canvas.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(s.canvas, 0, 0);
    if (layer) ctx.drawImage(layer.canvas, layer.x, layer.y);
    const url = c.toDataURL('image/png');
    thumbCache.set(k, url);
    return url;
  }

  function panelDesign() {
    panel.appendChild(editingLabel());
    const grid = h('div', { class: 'thumbs' });
    const n = state.nails[ui.finger];
    M.PRESETS.forEach((p) => {
      const d = M.applyPreset(null, p);
      grid.appendChild(h('button', {
        type: 'button', class: 'thumb', 'aria-pressed': n.design && n.design.presetId === p.id ? 'true' : 'false',
        onclick: () => {
          if (needsContourToast()) return;
          n.design = M.applyPreset(n.design, p);
          ui.selDeco = -1;
          commit(); markDirty(); renderPanel();
          toast(fname(ui.finger) + '：' + p.name);
        },
      }, [h('img', { src: presetThumb(p.id, d), alt: '' }), h('span', { text: p.name })]));
    });
    panel.appendChild(group('試着用デザイン', [grid, note('サンプル素材はこのアプリ用に作成したものです。指で選ぶと、編集中の指に適用します。')]));

    const mats = h('div', { class: 'thumbs' });
    state.materials.forEach((m) => {
      const a = S.get(m.assetId);
      mats.appendChild(h('button', {
        type: 'button', class: 'thumb',
        'aria-pressed': n.design && n.design.art && n.design.art.assetId === m.assetId ? 'true' : 'false',
        onclick: () => {
          if (needsContourToast()) return;
          const d = ensureDesign(ui.finger);
          d.art = { kind: 'image', assetId: m.assetId, name: m.name };
          d.tf = M.defaultDesign().tf; d.presetId = null;
          commit(); markDirty(); renderPanel();
        },
      }, [a ? h('img', { src: a.url, alt: '' }) : null, h('span', { class: 'cap', text: m.name })]));
    });
    panel.appendChild(group('素材を読み込む', [
      state.materials.length ? mats : null,
      btn('透過PNGの素材を読み込む', () => $('fileMaterial').click()),
      note('掲載許可を得た素材や、自分で作った柄（透過PNG推奨）を使えます。'),
    ]));

    if (needContour()) return;
    const d = n.design;
    if (d && d.art && (d.art.kind === 'pattern' || d.art.kind === 'image')) {
      const kids = [];
      if (d.art.kind === 'pattern') {
        kids.push(h('p', { class: 'note', text: '柄の色' }));
        kids.push(swatches(d.art.fg, (c) => { d.art.fg = c; commit(); markDirty(); renderPanel(); }));
      }
      panel.appendChild(group('位置・大きさの調整', kids.concat(tfControls(d, d.art.kind === 'image'))));
    }
    if (d) {
      panel.appendChild(copyTargets((id) => {
        state.nails[id].design = U.clone(d);
      }, 'このデザインをほかの指にも適用'));
    }
  }
  function needsContourToast() {
    const n = state.nails[ui.finger];
    if (n.skip || n.shape.points.length < 3) { toast('先に' + fname(ui.finger) + 'の輪郭を作ってください'); return true; }
    return false;
  }

  /* --- ③ 自分でデザインする --- */
  function panelCustom() {
    panel.appendChild(editingLabel());
    if (needContour()) return;
    const n = state.nails[ui.finger];
    const d = ensureDesign(ui.finger);
    if (JSON.stringify(state) !== hist.last) { commit(); markDirty(); }

    panel.appendChild(group('ベースの色', [
      swatches(d.color, (c) => { d.color = c; d.presetId = null; commit(); markDirty(); renderPanel(); }, { allowNone: true }),
      colorPicker(d.color, (c) => { d.color = c; d.presetId = null; }),
      h('div', { class: 'row' }, [
        btn('この色を設定済みの全指へ', () => {
          const ids = fingersWithContour();
          ids.forEach((id) => { ensureDesign(id).color = d.color; });
          commit(); markDirty(); renderFingers();
          toast(ids.length + '本の指に同じ色を適用しました');
        }),
      ]),
    ]));

    panel.appendChild(group('仕上がりの調整', [
      slider('不透明度', d.opacity, 0.1, 1, 0.01, pct, (v) => (d.opacity = v)),
      note('下げると透明感が出ます。元の爪の色・模様も透けて見えます。'),
      slider('明暗の反映', d.shadeAmt, 0, 1, 0.01, pct, (v) => (d.shadeAmt = v)),
      slider('光沢', d.gloss, 0, 1, 0.01, pct, (v) => (d.gloss = v)),
      slider('縁のなじませ', d.feather, 0, 3, 0.1, (v) => v.toFixed(1) + 'px', (v) => (d.feather = v)),
      note('縁のなじませは輪郭の内側だけで行い、肌には色が付きません。'),
    ]));

    const fr = d.french;
    panel.appendChild(group('フレンチ', [
      h('label', { class: 'toggle' }, [h('input', { type: 'checkbox', checked: fr.on, onchange: (e) => { fr.on = e.target.checked; commit(); markDirty(); renderPanel(); } }), '先端に色を重ねる']),
      fr.on ? swatches(fr.color, (c) => { fr.color = c; commit(); markDirty(); renderPanel(); }, { colors: ['#ffffff', '#f6e7dc', '#f3d6d3', '#d46a7e', '#d9b26a', '#3b2f33'] }) : null,
      fr.on ? slider('先端の太さ', fr.width, 0.08, 0.6, 0.01, pct, (v) => (fr.width = v)) : null,
    ]));

    const gl = d.glitter;
    panel.appendChild(group('ラメ風', [
      h('label', { class: 'toggle' }, [h('input', { type: 'checkbox', checked: gl.on, onchange: (e) => { gl.on = e.target.checked; commit(); markDirty(); renderPanel(); } }), 'ラメ風を重ねる']),
      gl.on ? swatches(gl.color, (c) => { gl.color = c; commit(); markDirty(); renderPanel(); }, { colors: ['#d9b26a', '#e8e4ec', '#f3b8c6', '#b9c9e6', '#c9a3c7', '#8a6d4a'] }) : null,
      gl.on ? slider('強さ', gl.amount, 0.05, 1, 0.01, pct, (v) => (gl.amount = v)) : null,
    ]));

    panel.appendChild(decoGroup(d));

    panel.appendChild(copyTargets((id) => { state.nails[id].design = U.clone(d); }, 'この指のデザインをほかの指にもコピー'));
    panel.appendChild(h('div', { class: 'row' }, [
      btn('この指のデザインを消す', async () => {
        if (!(await confirmDialog('デザインを消しますか？', fname(ui.finger) + 'の色・柄・装飾を消します。輪郭は残ります。', '消す', true))) return;
        n.design = null; ui.selDeco = -1; commit(); markDirty(); renderPanel();
      }, 'danger'),
    ]));
  }

  function decoGroup(d) {
    const kids = [];
    kids.push(h('div', { class: 'row' }, M.DECOS.map((t) => btn('＋' + t.name, () => {
      const colors = { circle: '#ffffff', heart: '#d46a7e', star: '#d9b26a', pearl: '#f6efe6' };
      d.decos.push({ type: t.id, color: colors[t.id], x: 0.5, y: 0.3 + (d.decos.length % 3) * 0.15, size: 0.22, rot: 0 });
      ui.selDeco = d.decos.length - 1;
      commit(); markDirty(); renderPanel();
    }))));
    if (d.decos.length) {
      kids.push(h('div', { class: 'chips' }, d.decos.map((x, i) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': ui.selDeco === i ? 'true' : 'false',
        onclick: () => { ui.selDeco = i; renderPanel(); },
      }, (M.DECOS.find((t) => t.id === x.type) || {}).name + ' ' + (i + 1)))));
    }
    const s = d.decos[ui.selDeco];
    if (s) {
      kids.push(swatches(s.color, (c) => { s.color = c; commit(); markDirty(); renderPanel(); }, { colors: ['#ffffff', '#f6efe6', '#d46a7e', '#d9b26a', '#9fb8d6', '#3b2f33'] }));
      kids.push(slider('位置（横）', s.x, 0, 1, 0.01, pct, (v) => (s.x = v)));
      kids.push(slider('位置（縦）', s.y, 0, 1, 0.01, (v) => (v < 0.2 ? '先端寄り' : v > 0.8 ? '根元寄り' : pct(v)), (v) => (s.y = v)));
      kids.push(slider('大きさ', s.size, 0.06, 0.6, 0.01, pct, (v) => (s.size = v)));
      kids.push(slider('回転', s.rot, -180, 180, 1, (v) => Math.round(v) + '°', (v) => (s.rot = v)));
      kids.push(btn('この装飾を削除', () => { d.decos.splice(ui.selDeco, 1); ui.selDeco = -1; commit(); markDirty(); renderPanel(); }, 'danger'));
    }
    kids.push(note('装飾は2Dの見本表現です。実際のパーツの立体感・質感は再現していません。'));
    return group('装飾', kids);
  }

  /* --- 保存・書き出し --- */
  function panelExport() {
    panel.appendChild(h('h2', { text: '保存してネイリストに見せる' }));
    const ta = h('textarea', { id: 'memo', maxlength: '300', placeholder: '例：薬指だけ花柄、ほかは肌なじみのよいピンクで。長さは今のままで。' });
    ta.value = state.memo || '';
    ta.addEventListener('input', () => { state.memo = ta.value; });
    ta.addEventListener('change', () => commit());
    panel.appendChild(group('希望メモ（相談用シートに入ります）', [ta]));
    panel.appendChild(group('画像を保存（PNG）', [
      btn('ネイルを適用した手の写真', exportPhoto, 'primary big'),
      btn('相談用シート', exportSheet, 'primary big'),
      note('仕上がりの相談用イメージです。実際の施術の仕上がりを保証するものではありません。'),
    ]));
    panel.appendChild(group('編集データ', [
      h('p', { class: 'note', text: ui.idbOK ? (ui.lastSaved ? 'この端末に自動保存しました（' + ui.lastSaved + '）' : 'この端末に自動保存します') : 'この環境では端末内の自動保存が使えません。編集データを書き出してください。' }),
      h('div', { class: 'row' }, [btn('編集データを書き出す', exportProject), btn('編集データを読み込む', () => $('fileProject').click())]),
      note('端末内の保存はブラウザのデータ消去で消えることがあります。大切な作業は書き出しておくと安心です。'),
    ]));
    panel.appendChild(group('写真', [
      h('div', { class: 'row' }, [
        btn('撮り方ガイド', openGuide),
        btn('別の手の写真に替える', async () => {
          if (!(await confirmDialog('写真を替えますか？', '今の輪郭とデザインはリセットされます（「戻す」で元に戻せます）。', '写真を選ぶ'))) return;
          $('filePhoto').click();
        }),
        btn('新しく始める', async () => {
          if (!(await confirmDialog('最初からやり直しますか？', '端末内に保存した作業も消えます。必要なら先に編集データを書き出してください。', '最初から', true))) return;
          state = emptyState(); resetHistory();
          try { await S.idb.clearProject(); } catch (_) { /* noop */ }
          buildPhotoCanvas(); buildRefCanvas();
          showStart();
        }, 'danger'),
      ]),
    ]));
  }

  /* ================= 書き出し ================= */
  async function exportPhoto() {
    if (!photoCanvas) return;
    const c = R.composite(state, env());
    compDirty = true;
    const blob = await U.canvasToBlob(c, 'image/png');
    showExport(blob, 'nail-preview.png', 'ネイルを適用した手の写真');
  }
  async function exportSheet() {
    if (!photoCanvas) return;
    const c = R.composite(state, env());
    const sh = R.sheet(state, env(), c);
    compDirty = true;
    const blob = await U.canvasToBlob(sh, 'image/png');
    showExport(blob, 'nail-consultation.png', '相談用シート');
  }
  async function exportProject() {
    const assets = {};
    for (const id of new Set(referencedAssets())) assets[id] = await S.toDataURL(id);
    const json = JSON.stringify({ app: 'naildesigner', format: 1, savedAt: new Date().toISOString(), state, assets });
    const blob = new Blob([json], { type: 'application/json' });
    showExport(blob, 'nail-project.json', '編集データ', true);
  }

  let downloadsCap;
  function getDownloads() {
    if (downloadsCap !== undefined) return Promise.resolve(downloadsCap);
    if (!(window.claude && typeof window.claude.use === 'function')) { downloadsCap = null; return Promise.resolve(null); }
    return window.claude.use('downloads').then((d) => (downloadsCap = d || null)).catch(() => (downloadsCap = null));
  }

  function showExport(blob, filename, title, isData) {
    const url = URL.createObjectURL(blob);
    const body = $('modalBody');
    body.innerHTML = '';
    if (!isData) body.appendChild(h('img', { class: 'export-img', src: url, alt: title }));
    const status = h('p', { class: 'note' });
    body.appendChild(status);
    body.appendChild(note(isData
      ? '「保存する」で .json ファイルとして保存します。後で「編集データを読み込む」から再開できます。'
      : '「保存する」が使えない場合は、上の画像を長押しして「"写真"に追加」または「画像を保存」を選んでください。'));
    openModal(title + 'を保存', body, [
      { label: '閉じる', onclick: () => { closeModal(); URL.revokeObjectURL(url); } },
      { label: '保存する', primary: true, onclick: () => saveBlob(blob, filename, url, status, isData) },
    ]);
  }

  async function saveBlob(blob, filename, url, status, isData) {
    status.textContent = '保存しています…';
    const dl = await getDownloads();
    if (dl) {
      try {
        await dl.save({ filename, data: blob });
        status.textContent = '保存しました。';
        return;
      } catch (e) {
        if (e && e.code === 'declined') { status.textContent = '保存をキャンセルしました。'; return; }
      }
    }
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        status.textContent = '共有メニューを開きました。「画像を保存」などを選んでください。';
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { status.textContent = '共有をキャンセルしました。'; return; }
    }
    try {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      status.textContent = isData
        ? 'ダウンロードを開始しました。始まらない場合、このブラウザでは保存できません。別のブラウザ（Safari）で開いてお試しください。'
        : 'ダウンロードを開始しました。始まらない場合は、画像を長押しして保存してください。';
    } catch (e) {
      status.textContent = isData ? 'このブラウザでは保存できませんでした。' : 'このブラウザでは保存できませんでした。画像を長押しして保存してください。';
    }
  }

  /* ================= 読み込み ================= */
  async function loadPhotoFile(file) {
    try {
      const r = await S.addImageFile(file, { maxSide: 2000 });
      state = emptyState();
      state.photo = { assetId: r.id, w: r.w, h: r.h, demo: false };
      buildPhotoCanvas();
      fitView('photo');
      ui.tab = 'contour'; ui.finger = 'thumb'; ui.selPt = -1; ui.pendingCut = null;
      commit();
      hideStart();
      renderAll();
      const issues = checkPhoto(photoCanvas);
      if (issues.length) showPhotoIssues(issues);
      toast(r.scaled ? '写真を ' + r.w + '×' + r.h + ' に縮小して読み込みました（元 ' + r.origW + '×' + r.origH + '）' : '写真を読み込みました');
    } catch (e) { showError(e); }
  }

  async function loadDemo() {
    const d = ND.demo.hand();
    const id = await S.addCanvas(d.canvas, 'image/jpeg');
    state = emptyState();
    state.photo = { assetId: id, w: d.canvas.width, h: d.canvas.height, demo: true };
    d.preset.forEach((fid) => { state.nails[fid].shape = U.clone(d.shapes[fid]); });
    state.nails.index.design = M.defaultDesign();
    state.nails.middle.design = M.applyPreset(null, M.PRESETS.find((p) => p.id === 'flowers'));
    buildPhotoCanvas();
    fitView('photo');
    ui.tab = 'contour'; ui.finger = 'thumb'; ui.selPt = -1; ui.pendingCut = null;
    commit();
    hideStart();
    renderAll();
    toast('図解デモです。人差し指〜薬指には例の輪郭が入っています');
  }

  async function importProjectFile(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
      if (!data || data.app !== 'naildesigner' || !data.state || !data.state.nails) throw new Error('format');
    } catch (e) {
      showError({ userMessage: 'このファイルはネイル試着ノートの編集データではないようです。書き出した .json ファイルを選んでください。' });
      return;
    }
    if (state.photo && !(await confirmDialog('編集データを読み込みますか？', '今の作業は置き換わります（「戻す」で元に戻せます）。', '読み込む'))) return;
    try {
      for (const id of Object.keys(data.assets || {})) {
        if (!S.get(id) && data.assets[id]) await S.add(U.dataURLToBlob(data.assets[id]), id);
      }
      state = normalizeState(data.state);
      buildPhotoCanvas(); buildRefCanvas();
      fitView('photo'); if (state.refDraft) fitView('ref');
      if (hist.last === null) resetHistory(); else commit();
      hideStart();
      renderAll();
      toast('編集データを読み込みました');
    } catch (e) { showError({ userMessage: '編集データの画像を読み込めませんでした。ファイルが壊れている可能性があります。' }); }
  }

  function normalizeState(st) {
    const base = emptyState();
    const out = Object.assign(base, st);
    FINGERS.forEach((f) => { out.nails[f.id] = Object.assign(emptyNail(), (st.nails || {})[f.id] || {}); });
    out.cutouts = out.cutouts || []; out.materials = out.materials || [];
    return out;
  }

  async function loadMaterialFile(file) {
    try {
      const r = await S.addImageFile(file, { maxSide: 1024, keepAlpha: true });
      state.materials.push({ id: U.uid('mat'), assetId: r.id, w: r.w, h: r.h, name: (file.name || '素材').replace(/\.[^.]+$/, '').slice(0, 14) });
      if (state.nails[ui.finger].shape.points.length >= 3 && !state.nails[ui.finger].skip) {
        const d = ensureDesign(ui.finger);
        d.art = { kind: 'image', assetId: r.id, name: file.name };
        d.tf = M.defaultDesign().tf; d.presetId = null;
      }
      commit(); markDirty(); renderPanel();
      toast('素材を読み込みました');
    } catch (e) { showError(e); }
  }

  /* ================= 端末内保存 ================= */
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    if (!state.photo) return;
    try {
      await S.persist(referencedAssets());
      await S.idb.putProject({ state: JSON.parse(JSON.stringify(state)), savedAt: Date.now() });
      const d = new Date();
      ui.lastSaved = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      ui.idbOK = true;
    } catch (e) {
      if (ui.idbOK) toast('端末内に保存できませんでした。「保存」タブから編集データを書き出せます');
      ui.idbOK = false;
    }
  }
  async function resumeSaved() {
    try {
      const p = await S.idb.getProject();
      if (!p || !p.state) return;
      state = normalizeState(p.state);
      const missing = await ensureAssets();
      if (missing.length && state.photo && missing.includes(state.photo.assetId)) {
        showError({ userMessage: '保存した写真を読み込めませんでした。編集データの書き出しがあれば、そちらから読み込んでください。' });
        state = emptyState();
        return;
      }
      buildPhotoCanvas(); buildRefCanvas();
      fitView('photo'); if (state.refDraft) fitView('ref');
      resetHistory();
      hideStart();
      renderAll();
      toast('前回の作業を再開しました');
      // 使われなくなった画像を整理
      const keep = new Set(referencedAssets());
      const keys = await S.idb.assetKeys();
      for (const k of keys) if (!keep.has(k)) await S.idb.deleteAsset(k);
    } catch (e) {
      showError({ userMessage: '前回の作業を読み込めませんでした。' });
    }
  }

  /* ================= モーダル・通知 ================= */
  let modalResolve = null;
  function openModal(title, bodyEl, actions) {
    $('modalTitle').textContent = title;
    const body = $('modalBody');
    if (bodyEl !== body) { body.innerHTML = ''; if (bodyEl) body.appendChild(bodyEl); }
    const act = $('modalActions');
    act.innerHTML = '';
    actions.forEach((a) => act.appendChild(btn(a.label, a.onclick, (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''))));
    $('modal').hidden = false;
  }
  function closeModal() {
    $('modal').hidden = true;
    if (modalResolve) { modalResolve(false); modalResolve = null; }
  }
  function confirmDialog(title, msg, okLabel, danger) {
    return new Promise((resolve) => {
      openModal(title, h('p', { text: msg }), [
        { label: 'キャンセル', onclick: () => { modalResolve = null; $('modal').hidden = true; resolve(false); } },
        { label: okLabel || 'OK', primary: !danger, danger, onclick: () => { modalResolve = null; $('modal').hidden = true; resolve(true); } },
      ]);
      modalResolve = resolve;
    });
  }
  function showError(e) {
    const msg = (e && e.userMessage) || '処理できませんでした。もう一度お試しください。';
    openModal('読み込めませんでした', h('p', { text: msg }), [{ label: '閉じる', primary: true, onclick: closeModal }]);
    if (e && !e.userMessage && e.message) console.warn(e);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  function showStart() {
    $('startScreen').hidden = false;
    S.idb.getProject().then((p) => { $('startResume').hidden = !(p && p.state && p.state.photo); }).catch(() => { $('startResume').hidden = true; });
  }
  function hideStart() { $('startScreen').hidden = true; }

  function openGuide() {
    document.querySelectorAll('#guideScreen img[data-guide]').forEach((im) => {
      if (!im.getAttribute('src')) im.src = ND.demo.guideImage(im.dataset.guide);
    });
    $('guideScreen').hidden = false;
    $('guideScreen').scrollTop = 0;
    try { localStorage.setItem('nd_guide_seen', '1'); } catch (_) { /* noop */ }
  }
  function closeGuide() { $('guideScreen').hidden = true; }

  /* 読み込んだ写真の明るさ・大きさを目安としてチェック（自動で撮り直しを強制はしない） */
  function checkPhoto(canvas) {
    const n = 64;
    const c = U.makeCanvas(n, n);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    let sum = 0, bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; if (l > 248) bright++;
    }
    const mean = sum / (n * n);
    const issues = [];
    if (mean < 70) issues.push('写真が暗めです。明るい場所で撮ると、色の見え方が正確になります。');
    if (bright / (n * n) > 0.3) issues.push('白く飛んでいる部分が多めです。フラッシュをオフにするか、光が直接当たらない場所で撮ってみてください。');
    if (Math.min(canvas.width, canvas.height) < 700) issues.push('写真が小さめです（' + canvas.width + '×' + canvas.height + '）。拡大すると粗く見えることがあります。');
    return issues;
  }
  function showPhotoIssues(issues) {
    const body = h('div', null, [
      h('ul', { class: 'photo-issues' }, issues.map((t) => h('li', { text: t }))),
      note('目安のチェックです。このまま使っても問題ありません。'),
    ]);
    openModal('写真の確認', body, [
      { label: '撮り方を見る', onclick: () => { closeModal(); openGuide(); } },
      { label: 'このまま使う', primary: true, onclick: closeModal },
    ]);
  }

  function syncCompare() {
    $('btnCompare').setAttribute('aria-pressed', ui.compare ? 'true' : 'false');
    $('compareLabel').textContent = ui.compare ? '変更前' : '変更後';
  }

  /* ================= 起動 ================= */
  function bind() {
    document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnCompare').addEventListener('click', () => {
      if (refMode()) { toast('参考画像の編集中は比較できません'); return; }
      ui.compare = !ui.compare; syncCompare(); requestDraw();
    });
    $('btnGuide').addEventListener('click', () => {
      ui.guides = !ui.guides;
      $('btnGuide').setAttribute('aria-pressed', ui.guides ? 'true' : 'false');
      $('guideLabel').textContent = ui.guides ? '表示' : '非表示';
      requestDraw();
    });
    $('toolEdit').addEventListener('click', () => { ui.tool = 'edit'; renderTabs(); requestDraw(); });
    $('toolPan').addEventListener('click', () => { ui.tool = 'pan'; ui.place = 'point'; renderTabs(); renderPanel(); requestDraw(); });
    const center = () => { const s = stageSize(); return { x: s.w / 2, y: s.h / 2 }; };
    $('zoomIn').addEventListener('click', () => zoomAt(center(), 1.4));
    $('zoomOut').addEventListener('click', () => zoomAt(center(), 1 / 1.4));
    $('zoomFit').addEventListener('click', () => { fitView(viewKey()); requestDraw(); });
    $('zoomNail').addEventListener('click', () => {
      const f = U.nailFrame(state.nails[ui.finger].shape);
      if (!f) { toast(fname(ui.finger) + 'の輪郭がまだありません'); return; }
      const X = viewXf();
      const bw = f.bounds.x1 - f.bounds.x0, bh = f.bounds.y1 - f.bounds.y0;
      const st = stageSize();
      const v = ui.views.photo;
      v.zoom = U.clamp(Math.min(st.w / bw, st.h / bh) * 0.45 / X.fit, 0.5, 14);
      v.cx = (f.bounds.x0 + f.bounds.x1) / 2; v.cy = (f.bounds.y0 + f.bounds.y1) / 2;
      requestDraw();
    });

    const onFile = (id, fn) => $(id).addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (id !== 'fileProject' && f.type && !f.type.startsWith('image/')) {
        showError({ userMessage: '画像ファイルではないようです（' + f.type + '）。JPEG・PNGなどの画像を選んでください。' });
        return;
      }
      fn(f);
    });
    onFile('filePhoto', loadPhotoFile);
    onFile('fileRef', loadRefFile);
    onFile('fileMaterial', loadMaterialFile);
    onFile('fileProject', importProjectFile);

    // 初めて写真を選ぶときは、先に撮り方ガイドを見せる
    $('startPick').addEventListener('click', () => {
      let seen = false;
      try { seen = localStorage.getItem('nd_guide_seen') === '1'; } catch (_) { /* noop */ }
      if (seen) $('filePhoto').click(); else openGuide();
    });
    $('startGuide').addEventListener('click', openGuide);
    $('guideClose').addEventListener('click', closeGuide);
    $('guidePick').addEventListener('click', () => { closeGuide(); $('filePhoto').click(); });
    $('startDemo').addEventListener('click', loadDemo);
    $('startResume').addEventListener('click', resumeSaved);
    $('startImport').addEventListener('click', () => $('fileProject').click());
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal') && !modalResolve) closeModal(); });

    const ro = window.ResizeObserver ? new ResizeObserver(() => requestDraw()) : null;
    if (ro) ro.observe(stage);
    window.addEventListener('resize', requestDraw);
    window.addEventListener('orientationchange', () => setTimeout(requestDraw, 200));
  }

  function init() {
    bind();
    resetHistory();
    renderAll();
    showStart();
    S.idb.available().then((ok) => { ui.idbOK = ok; });
    getDownloads();
  }

  // テスト・デバッグ用の読み取り口
  ND.app = { get state() { return state; }, ui, undo, redo, commit, loadDemo, loadDemoRef, makeCutout, exportPhoto, exportSheet, viewXf, toScreen, setTab, selectFinger, hist };

  init();
})();
