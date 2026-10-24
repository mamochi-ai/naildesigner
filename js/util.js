/* 共通ユーティリティ・幾何計算 */
(function () {
  'use strict';
  const ND = (window.ND = window.ND || {});

  const FINGERS = [
    { id: 'thumb', name: '親指' },
    { id: 'index', name: '人差し指' },
    { id: 'middle', name: '中指' },
    { id: 'ring', name: '薬指' },
    { id: 'pinky', name: '小指' },
  ];

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // 決定的な乱数（柄が描画のたびに変わらないように）
  function rng(seed) {
    let s = 0;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) | 0;
    s = s || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 1000000) / 1000000;
    };
  }

  /* 閉じた輪郭をなめらかな曲線に（カーディナルスプライン）。smooth=0 で多角形 */
  function smoothContour(points, smooth, seg) {
    const n = points.length;
    if (n < 3) return points.slice();
    seg = seg || 10;
    const out = [];
    const k = clamp(smooth, 0, 1);
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i];
      const p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      const m1x = (k * (p2.x - p0.x)) / 2, m1y = (k * (p2.y - p0.y)) / 2;
      const m2x = (k * (p3.x - p1.x)) / 2, m2y = (k * (p3.y - p1.y)) / 2;
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        out.push({
          x: h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
          y: h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
        });
      }
    }
    return out;
  }

  // 点の追加位置：周長の増加が最小になる辺に挿入
  function insertIndex(points, p) {
    if (points.length < 3) return points.length;
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const cost = dist(a, p) + dist(p, b) - dist(a, b);
      if (cost < bestCost) { bestCost = cost; best = i + 1; }
    }
    return best;
  }

  // 主軸（PCA）から根元・先端を仮置き。画面上で上側を先端と仮定
  function guessAxis(points) {
    let cx = 0, cy = 0;
    points.forEach((p) => { cx += p.x; cy += p.y; });
    cx /= points.length; cy /= points.length;
    let sxx = 0, syy = 0, sxy = 0;
    points.forEach((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    });
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let ux = Math.cos(ang), uy = Math.sin(ang);
    let mn = Infinity, mx = -Infinity;
    points.forEach((p) => {
      const t = (p.x - cx) * ux + (p.y - cy) * uy;
      mn = Math.min(mn, t); mx = Math.max(mx, t);
    });
    let a = { x: cx + ux * mn * 0.85, y: cy + uy * mn * 0.85 };
    let b = { x: cx + ux * mx * 0.85, y: cy + uy * mx * 0.85 };
    if (a.y < b.y) { const t = a; a = b; b = t; }
    return { base: a, tip: b };
  }

  /* 第1・第2関節を結ぶ線（指の中心線）から、根元・先端を決める。
     根元・先端は、その線と平行で、爪の輪郭の両端に置く */
  function axisFromJoints(points, smooth, j1, j2) {
    const cont = smoothContour(points, smooth == null ? 0.6 : smooth, 10);
    let dx = j1.x - j2.x, dy = j1.y - j2.y;
    const L = Math.hypot(dx, dy);
    if (L < 1 || cont.length < 3) return null;
    dx /= L; dy /= L; // 根元→先端の向き（第2関節→第1関節の延長）
    const nx = -dy, ny = dx;
    const hits = (ox, oy) => {
      const ts = [];
      for (let i = 0; i < cont.length; i++) {
        const a = cont[i], b = cont[(i + 1) % cont.length];
        const da = (a.x - ox) * nx + (a.y - oy) * ny, db = (b.x - ox) * nx + (b.y - oy) * ny;
        if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
          const k = da / (da - db);
          const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
          ts.push((px - ox) * dx + (py - oy) * dy);
        }
      }
      return ts;
    };
    let ox = j1.x, oy = j1.y;
    let ts = hits(ox, oy);
    if (ts.length < 2) {
      // 関節の線が爪から外れているときは、同じ向きで爪の中心を通る線を使う
      ox = 0; oy = 0;
      cont.forEach((p) => { ox += p.x; oy += p.y; });
      ox /= cont.length; oy /= cont.length;
      ts = hits(ox, oy);
      if (ts.length < 2) return null;
    }
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    return { base: { x: ox + dx * t0, y: oy + dy * t0 }, tip: { x: ox + dx * t1, y: oy + dy * t1 } };
  }

  /* 爪の座標系。u=幅方向（右）、v=根元→先端方向 */
  /* つけ爪（長さだし）の先端形状。p は角の丸さ、cap は先端カーブの長さ（爪幅の半分に対する倍率） */
  const EXT_SHAPES = {
    round: { name: 'ラウンド', p: 2, cap: 1.0 },
    oval: { name: 'オーバル', p: 2, cap: 1.6 },
    square: { name: 'スクエア', p: 8, cap: 0.45 },
    squareoval: { name: 'スクエアオフ', p: 3.2, cap: 0.75 },
    almond: { name: 'アーモンド', p: 1.5, cap: 2.3 },
    point: { name: 'ポイント', p: 1, cap: 3.2 },
  };

  // 自分の爪の根元〜側面はそのまま使い、先端側だけを指定の長さと形に作り直す
  function extendContour(nat, base, u, v, ext) {
    const loc = nat.map((p) => {
      const dx = p.x - base.x, dy = p.y - base.y;
      return { u: dx * u.x + dy * u.y, v: dx * v.x + dy * v.y };
    });
    let vmin = Infinity, vmax = -Infinity;
    loc.forEach((q) => { vmin = Math.min(vmin, q.v); vmax = Math.max(vmax, q.v); });
    const L = vmax - vmin;
    const cutV = vmin + 0.72 * L;
    const span = (t) => {
      let l = Infinity, r = -Infinity;
      for (let i = 0; i < loc.length; i++) {
        const a = loc[i], b = loc[(i + 1) % loc.length];
        if ((a.v - t) * (b.v - t) <= 0 && a.v !== b.v) {
          const x = a.u + ((t - a.v) / (b.v - a.v)) * (b.u - a.u);
          l = Math.min(l, x); r = Math.max(r, x);
        }
      }
      return l <= r ? { l, r } : null;
    };
    const left = [], right = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const t = vmin + (cutV - vmin) * (0.02 + (0.98 * i) / N);
      const sp = span(t);
      if (sp) { left.push({ u: sp.l, v: t }); right.push({ u: sp.r, v: t }); }
    }
    if (left.length < 2) return nat;
    const top = left.length - 1;
    const hw = (right[top].u - left[top].u) / 2, cu = (right[top].u + left[top].u) / 2;
    const P = EXT_SHAPES[ext.shape] || EXT_SHAPES.oval;
    const tipV = vmax + Math.max(0, ext.length) * L;
    const zone = Math.max(1, tipV - cutV);
    const sc = 1 - Math.min(zone, P.cap * hw) / zone;
    const eL = [], eR = [];
    const M = 32;
    for (let i = 1; i <= M; i++) {
      const s2 = i / M, y = cutV + zone * s2;
      const q = s2 <= sc ? 0 : (s2 - sc) / (1 - sc);
      const g = q <= 0 ? 1 : Math.pow(Math.max(0, 1 - Math.pow(q, P.p)), 1 / P.p);
      eL.push({ u: cu - hw * g, v: y }); eR.push({ u: cu + hw * g, v: y });
    }
    const ring = left.concat(eL, eR.reverse(), right.reverse());
    return ring.map((q) => ({ x: base.x + q.u * u.x + q.v * v.x, y: base.y + q.u * u.y + q.v * v.y }));
  }

  function nailFrame(shape) {
    if (!shape || !shape.points || shape.points.length < 3) return null;
    const natural = smoothContour(shape.points, shape.smooth == null ? 0.6 : shape.smooth, 10);
    let contour = natural;
    let base = shape.base, tip = shape.tip;
    if (!base || !tip) { const g = guessAxis(shape.points); base = base || g.base; tip = tip || g.tip; }
    let vx = tip.x - base.x, vy = tip.y - base.y;
    const L = Math.hypot(vx, vy) || 1;
    vx /= L; vy /= L;
    const u = { x: -vy, y: vx };
    const v = { x: vx, y: vy };
    const extOn = !!(shape.ext && shape.ext.on);
    if (extOn) contour = extendContour(natural, base, u, v, shape.ext);
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    contour.forEach((p) => {
      const dx = p.x - base.x, dy = p.y - base.y;
      const pu = dx * u.x + dy * u.y, pv = dx * v.x + dy * v.y;
      umin = Math.min(umin, pu); umax = Math.max(umax, pu);
      vmin = Math.min(vmin, pv); vmax = Math.max(vmax, pv);
      bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y);
      bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y);
    });
    const W = Math.max(4, umax - umin), H = Math.max(4, vmax - vmin);
    const cu = (umin + umax) / 2, cv = (vmin + vmax) / 2;
    const C = { x: base.x + u.x * cu + v.x * cv, y: base.y + u.y * cu + v.y * cv };
    return {
      contour, natural, extOn, u, v, W, H, C, base, tip,
      bounds: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    };
  }

  // 爪ローカル座標(X:0..W 左→右, Y:0..H 先端→根元) → 画像座標 の変換行列
  function localToImage(f, ox, oy) {
    const { u, v, W, H, C } = f;
    return [u.x, u.y, -v.x, -v.y,
      C.x - (W / 2) * u.x + (H / 2) * v.x - (ox || 0),
      C.y - (W / 2) * u.y + (H / 2) * v.y - (oy || 0)];
  }
  // 画像座標 → 先端を上にした表示 (中心 cx,cy、倍率k)
  function imageToUpright(f, k, cx, cy) {
    const { u, v, C } = f;
    const a = k * u.x, c = k * u.y, b = -k * v.x, d = -k * v.y;
    return [a, b, c, d, cx - a * C.x - c * C.y, cy - b * C.x - d * C.y];
  }

  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function pathFrom(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function hexToRgb(hex) {
    const h = (hex || '#000000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    const f = (x) => (amt >= 0 ? x + (255 - x) * amt : x * (1 + amt));
    return rgbToHex(f(c.r), f(c.g), f(c.b));
  }

  function canvasToBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type || 'image/png', q);
    });
  }
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(url);
    if (!m) throw new Error('bad data url');
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'application/octet-stream' });
  }

  ND.util = {
    FINGERS, EXT_SHAPES, axisFromJoints, uid, clamp, clone, dist, rng, smoothContour, insertIndex, guessAxis, nailFrame,
    localToImage, imageToUpright, pointInPoly, pathFrom, makeCanvas, hexToRgb, rgbToHex, shade,
    canvasToBlob, blobToDataURL, dataURLToBlob,
  };
})();
