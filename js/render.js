/* 爪ごとの合成処理（Canvas 2D）
   - 輪郭マスクの外には一切描かない（縁のなじませは内側方向のみ）
   - 単色・柄には元写真の明暗を乗せて平面的になりすぎないようにする */
(function () {
  'use strict';
  const ND = (window.ND = window.ND || {});
  const U = ND.util, M = ND.materials;

  const texCache = new Map();
  const lumCache = new Map();
  const layerCache = new Map();
  function cacheSet(map, k, v, max) {
    map.set(k, v);
    if (map.size > (max || 40)) map.delete(map.keys().next().value);
  }

  function patternTexture(id, fg, W, S) {
    const key = id + '|' + fg + '|' + Math.round(W) + '|' + Math.round(S);
    let t = texCache.get(key);
    if (!t) {
      t = U.makeCanvas(S, S);
      const fn = M.PATTERNS[id];
      if (fn) fn(t.getContext('2d'), t.width, t.height, W, fg, id);
      cacheSet(texCache, key, t, 30);
    }
    return t;
  }

  function makeMask(f, x0, y0, bw, bh, feather, contour) {
    contour = contour || f.contour;
    const c = U.makeCanvas(bw, bh);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.translate(-x0, -y0);
    ctx.fillStyle = '#000';
    U.pathFrom(ctx, contour);
    ctx.fill();
    if (feather > 0.05) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineJoin = 'round';
      const n = 3;
      for (let k = 1; k <= n; k++) {
        ctx.globalAlpha = 0.33;
        ctx.lineWidth = (2 * feather * k) / n;
        U.pathFrom(ctx, contour);
        ctx.stroke();
      }
    }
    const d = ctx.getImageData(0, 0, bw, bh).data;
    const a = new Uint8ClampedArray(bw * bh);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }

  // 元写真の明るさ（平均を1に正規化）。単色を写真になじませるために使う
  // 元写真の明るさ（平均を1に正規化）。爪の範囲だけを使って強くぼかし、
  // 大まかな光と影だけを取り出す（元の爪のふちの線や肌のしわが透けて見えないように）
  function lumMap(env, key, x0, y0, bw, bh, mask, radius) {
    const R = Math.max(2, radius || 2);
    const k = env.photoId + '|' + key + '|' + x0 + ',' + y0 + ',' + bw + ',' + bh + '|' + R;
    const hit = lumCache.get(k);
    if (hit) return hit;
    const d = env.photo.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, bw, bh).data;
    const n = bw * bh;
    const Lm = new Float32Array(n), Wm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = mask[i] > 128 ? 1 : 0;
      Lm[i] = w * (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
      Wm[i] = w;
    }
    const BL = boxBlur(Lm, bw, bh, R), BW = boxBlur(Wm, bw, bh, R);
    const L = new Float32Array(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      L[i] = BW[i] > 1e-3 ? BL[i] / BW[i] : 0;
      if (mask[i] > 128) { sum += L[i]; cnt++; }
    }
    const mean = cnt ? sum / cnt : 128;
    for (let i = 0; i < n; i++) {
      const v = BW[i] > 1e-3 ? L[i] / (mean || 1) : 1;
      L[i] = v < 0.6 ? 0.6 : v > 1.35 ? 1.35 : v;
    }
    cacheSet(lumCache, k, L, 20);
    return L;
  }

  /* ---- 「形に沿わせる」貼り方 ----
     参考の爪と自分の爪を、根元から先端まで同じ割合の位置どうしで対応させ、
     各段の左右の端を合わせて貼る。隙間も切り落としも出ず、新しい模様は作らない。 */
  const spanCache = new Map();
  // 透過画像の各行で、不透明な部分の左端・右端を調べる
  function alphaSpans(key, img, w, h) {
    const hit = spanCache.get(key);
    if (hit) return hit;
    const c = U.makeCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const L = new Float32Array(h).fill(NaN), Rr = new Float32Array(h).fill(NaN);
    let maxW = 0;
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 128) { if (l < 0) l = x; r = x + 1; }
      if (l >= 0) { L[y] = l; Rr[y] = r; maxW = Math.max(maxW, r - l); }
    }
    const res = { L, R: Rr, maxW, h, w };
    cacheSet(spanCache, key, res, 30);
    return res;
  }
  // 参考の爪の縦横比と、先端の形の目安
  function analyzeCutout(key, img, w, h) {
    const sp = alphaSpans(key, img, w, h);
    let top = 0, bot = h - 1;
    while (top < h && isNaN(sp.L[top])) top++;
    while (bot > 0 && isNaN(sp.L[bot])) bot--;
    const len = Math.max(1, bot - top + 1);
    const rowAt = (t) => { const y = Math.round(top + t * len); return isNaN(sp.L[y]) ? 0 : sp.R[y] - sp.L[y]; };
    const r = rowAt(0.06) / (sp.maxW || 1);
    const shape = r >= 0.8 ? 'square' : r >= 0.6 ? 'squareoval' : r >= 0.42 ? (len / sp.maxW > 1.6 ? 'oval' : 'round') : r >= 0.25 ? 'almond' : 'point';
    return { aspect: len / (sp.maxW || 1), shape };
  }
  function localSpan(poly, y) {
    let l = Infinity, r = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
        const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        l = Math.min(l, x); r = Math.max(r, x);
      }
    }
    return l <= r ? [l, r] : null;
  }
  const warpCache = new Map();
  function shapeWarp(srcKey, src, f) {
    const key = srcKey + '|' + f.contour.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(';');
    const hit = warpCache.get(key);
    if (hit) return hit;
    const W = Math.ceil(f.W), H = Math.ceil(f.H);
    const c = U.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // 自分の爪の輪郭を爪の座標（X:左→右, Y:先端→根元）へ
    const poly = f.contour.map((p) => {
      const dx = p.x - f.C.x, dy = p.y - f.C.y;
      return { x: dx * f.u.x + dy * f.u.y + f.W / 2, y: f.H / 2 - (dx * f.v.x + dy * f.v.y) };
    });
    const sp = alphaSpans(srcKey, src.img, src.w, src.h);
    let top = 0, bot = src.h - 1;
    while (top < src.h && isNaN(sp.L[top])) top++;
    while (bot > 0 && isNaN(sp.L[bot])) bot--;
    const kx = src.img.naturalWidth / src.w, ky = src.img.naturalHeight / src.h;
    const len = Math.max(1, bot - top + 1);
    for (let y = 0; y < H; y++) {
      const m = localSpan(poly, y + 0.5);
      if (!m) continue;
      let sy = Math.min(bot, Math.max(top, Math.floor(top + ((y + 0.5) / H) * len)));
      let k2 = 0;
      while (isNaN(sp.L[sy]) && k2 < len) { sy += sy < (top + bot) / 2 ? 1 : -1; k2++; }
      if (isNaN(sp.L[sy])) continue;
      const sl = sp.L[sy], sr = sp.R[sy];
      const rowH = Math.max(1, len / H);
      g.drawImage(src.img, sl * kx, sy * ky, Math.max(1, sr - sl) * kx, rowH * ky, m[0] - 1, y, m[1] - m[0] + 2, 1.01);
    }
    cacheSet(warpCache, key, c, 20);
    return c;
  }

  /* 写真柄・素材の基準倍率（A 比率を保つ：爪全体を覆う最小の倍率） */
  function artBaseK(W, H, iw, ih) { return Math.max(W / iw, H / ih); }

  function drawArt(p, f, d, env) {
    const W = f.W, H = f.H, t = d.tf, a = d.art;
    p.save();
    p.globalAlpha *= d.artOpacity == null ? 1 : d.artOpacity;
    if (a.kind === 'pattern') {
      p.translate(W / 2 + t.x * W, H / 2 + t.y * H);
      p.rotate((t.rot * Math.PI) / 180);
      p.scale(t.scale * (t.sx || 1) * (t.flip ? -1 : 1), t.scale * (t.sy || 1) * (t.aspect || 1));
      const S = Math.ceil(2.3 * Math.max(W, H));
      const tex = patternTexture(a.id, a.fg || '#ffffff', W, S);
      p.drawImage(tex, -S / 2, -S / 2);
    } else {
      // 写真柄は「先端の中央」を基準に置く。大きさを変えても先端側の柄がずれない
      const src = a.kind === 'cutout' ? env.cutoutImg(a.cutoutId) : env.assetImg(a.assetId);
      if (src) {
        const iw = src.w, ih = src.h;
        p.translate(W / 2 + t.x * W, t.y * H);
        p.rotate((t.rot * Math.PI) / 180);
        p.scale(t.scale * (t.sx || 1) * (t.flip ? -1 : 1), t.scale * (t.sy || 1) * (t.aspect || 1));
        if (t.fit === 'shape') {
          const key = (a.cutoutId || a.assetId) + '|' + iw + 'x' + ih;
          p.drawImage(shapeWarp(key, src, f), -W / 2, 0, W, H);
        } else if (t.fit === 'stretch') {
          p.drawImage(src.img, -W / 2, 0, W, H);
        } else {
          const k = artBaseK(W, H, iw, ih);
          p.drawImage(src.img, (-iw * k) / 2, 0, iw * k, ih * k);
        }
      }
    }
    p.restore();
  }

  // 柄を動かしている間、爪の外にはみ出した部分も薄く見せる（ctx は画像座標）
  function drawArtGhost(ctx, shape, design, env, alpha) {
    const f = U.nailFrame(shape);
    if (!f || !design || !design.art) return;
    const T = U.localToImage(f, 0, 0);
    ctx.save();
    ctx.transform(T[0], T[1], T[2], T[3], T[4], T[5]);
    ctx.globalAlpha = alpha;
    drawArt(ctx, f, design, env);
    ctx.restore();
  }

  function drawFrench(p, f, fr) {
    const W = f.W, H = f.H;
    const d0 = fr.width * H, side = d0 * 1.6;
    p.save();
    p.fillStyle = fr.color;
    p.beginPath();
    p.moveTo(-4, -4);
    p.lineTo(W + 4, -4);
    p.lineTo(W + 4, side);
    p.quadraticCurveTo(W / 2, 2 * d0 - side, -4, side);
    p.closePath();
    p.fill();
    p.restore();
  }

  function drawGlitter(p, f, g, seed) {
    const W = f.W, H = f.H;
    const r = U.rng('glitter' + seed);
    const sz = Math.max(1.1, W * 0.022);
    p.save();
    p.globalAlpha = 0.25 * g.amount;
    p.fillStyle = g.color;
    p.fillRect(-2, -2, W + 4, H + 4);
    p.globalAlpha = 1;
    const count = Math.round(((W * H) / (sz * sz)) * 0.12 * g.amount);
    for (let i = 0; i < count; i++) {
      const x = r() * W, y = r() * H;
      const s = sz * (0.5 + r() * 0.9);
      p.globalAlpha = 0.55 + r() * 0.45;
      p.fillStyle = r() < 0.12 ? '#ffffff' : U.shade(g.color, r() * 0.9 - 0.35);
      p.save(); p.translate(x, y); p.rotate(r() * Math.PI);
      p.fillRect(-s / 2, -s / 2, s, s);
      p.restore();
    }
    p.restore();
  }

  function drawGloss(p, f, amt) {
    const W = f.W, H = f.H;
    p.save();
    const g = p.createLinearGradient(W * 0.14, 0, W * 0.42, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,' + (0.6 * amt).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    p.fillStyle = g;
    p.beginPath();
    p.ellipse(W * 0.28, H * 0.45, W * 0.12, H * 0.32, 0, 0, Math.PI * 2);
    p.fill();
    p.fillStyle = 'rgba(255,255,255,' + (0.35 * amt).toFixed(3) + ')';
    p.beginPath();
    p.ellipse(W * 0.66, H * 0.2, W * 0.07, H * 0.06, 0.3, 0, Math.PI * 2);
    p.fill();
    p.restore();
  }

  /* 1本分のネイル層を作る。戻り値 { canvas, x, y, frame } （画像座標） */
  // 箱型ぼかし（横・縦に2回ずつ）。厚みの表現に使う
  function boxBlur(src, w, h, r) {
    const a = Float32Array.from(src), b = new Float32Array(w * h), n = 2 * r + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) { // 横：a → b
        const o = y * w;
        let s = 0;
        for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          b[o + x] = s / n;
          s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) { // 縦：b → a
        let s = 0;
        for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = s / n;
          s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
        }
      }
    }
    return a;
  }

  function nailLayer(shape, design, env, seed) {
    const f = U.nailFrame(shape);
    if (!f || !design) return null;
    const pw = env.photo.width, ph = env.photo.height;
    const thick = design.thick == null ? 0.35 : design.thick;
    // 厚みの影を爪の外側に落とすぶん、少し広く確保する
    const mg = 2 + (thick > 0.01 ? Math.ceil(f.W * 0.2) : 0);
    const x0 = U.clamp(Math.floor(f.bounds.x0) - mg, 0, pw);
    const y0 = U.clamp(Math.floor(f.bounds.y0) - mg, 0, ph);
    const x1 = U.clamp(Math.ceil(f.bounds.x1) + mg, 0, pw);
    const y1 = U.clamp(Math.ceil(f.bounds.y1) + mg, 0, ph);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 3 || bh < 3) return null;
    const skey = JSON.stringify(shape);
    const mask = makeMask(f, x0, y0, bw, bh, design.feather || 0);
    // つけ爪部分は肌や背景の上なので、元写真の明暗は自分の爪の範囲だけに使う
    const nat = f.extOn ? makeMask(f, x0, y0, bw, bh, 3, f.natural) : null;
    const lum = lumMap(env, skey, x0, y0, bw, bh, nat || mask, Math.round(f.W * 0.1));

    const c = U.makeCanvas(bw, bh);
    const p = c.getContext('2d');
    const T = U.localToImage(f, x0, y0);
    p.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    if (design.color) { p.fillStyle = design.color; p.fillRect(-3, -3, f.W + 6, f.H + 6); }
    if (design.art) drawArt(p, f, design, env);
    if (design.french && design.french.on) drawFrench(p, f, design.french);
    if (design.glitter && design.glitter.on) drawGlitter(p, f, design.glitter, seed || '');
    p.setTransform(1, 0, 0, 1, 0, 0);

    const id = p.getImageData(0, 0, bw, bh);
    const px = id.data;
    const sa = design.shadeAmt, op = design.opacity;
    // 立体感：爪は横方向に丸いので、両側と根元側をわずかに暗く、中央をわずかに明るくする
    const cvAmt = design.curve == null ? 0.5 : design.curve;
    const hwI = 2 / f.W, hhI = 2 / f.H, Cx = f.C.x - x0 - 0.5, Cy = f.C.y - y0 - 0.5;
    // 厚み：輪郭をぼかした高さの地図から、上から光が当たったときの縁の明暗を作る
    let B = null, R = 0;
    if (thick > 0.01) {
      R = Math.max(2, Math.round(f.W * (0.03 + 0.05 * thick)));
      const m0 = new Float32Array(bw * bh);
      for (let i = 0; i < m0.length; i++) m0[i] = mask[i] / 255;
      B = boxBlur(m0, bw, bh, R);
    }
    for (let i = 0, n = bw * bh; i < n; i++) {
      const m = mask[i];
      const j = i * 4;
      if (!m || !px[j + 3]) { px[j + 3] = 0; continue; }
      let lf = lum[i];
      if (nat) lf = 1 + (lf - 1) * (nat[i] / 255);
      let fac = 1 + sa * (lf - 1);
      fac = fac < 0.25 ? 0.25 : fac > 1.8 ? 1.8 : fac;
      if (cvAmt > 0) {
        const dx = (i % bw) - Cx, dy = ((i / bw) | 0) - Cy;
        let lu = Math.abs((dx * f.u.x + dy * f.u.y) * hwI); if (lu > 1) lu = 1;
        const lv = (dx * f.v.x + dy * f.v.y) * hhI;
        const back = lv < 0 ? Math.min(1, -lv) : 0;
        fac *= 1 + cvAmt * (0.07 * (1 - lu * lu) - 0.45 * Math.pow(lu, 2.4) - 0.14 * back * back * back);
      }
      let hl = 0;
      if (B) {
        const x = i % bw, y = (i / bw) | 0;
        const gx = B[i + (x < bw - 1 ? 1 : 0)] - B[i - (x > 0 ? 1 : 0)];
        const gy = B[i + (y < bh - 1 ? bw : 0)] - B[i - (y > 0 ? bw : 0)];
        hl = (0.45 * gx + 0.89 * gy) * R * 1.6; // 光は画面の上から
        hl = hl > 1 ? 1 : hl < -1 ? -1 : hl;
        fac *= 1 - thick * 0.22 * (1 - B[i]); // ふちほど少し暗く
      }
      for (let ch = 0; ch < 3; ch++) {
        let v = px[j + ch];
        v = fac < 1 ? v * fac : v + (255 - v) * (fac - 1) * 0.85;
        if (hl > 0) v += (255 - v) * hl * 0.6 * thick;
        else if (hl < 0) v *= 1 + hl * 0.45 * thick;
        px[j + ch] = v;
      }
      px[j + 3] = (px[j + 3] * op * m) / 255;
    }
    p.putImageData(id, 0, 0);

    // 爪の下に落ちる影（厚みがあるように見せる）。爪の内側には描かない
    if (thick > 0.01) {
      const sc = U.makeCanvas(bw, bh);
      const g = sc.getContext('2d');
      const OFF = 10000;
      g.translate(-x0 - OFF, -y0);
      g.shadowColor = 'rgba(45,28,22,' + (0.5 * thick).toFixed(3) + ')';
      g.shadowBlur = Math.max(2, f.W * 0.07 * (0.5 + thick));
      g.shadowOffsetX = OFF;
      g.shadowOffsetY = Math.max(1, f.W * 0.05 * thick);
      g.fillStyle = '#000';
      U.pathFrom(g, f.contour);
      g.fill();
      g.setTransform(1, 0, 0, 1, -x0, -y0);
      g.shadowColor = 'transparent';
      g.globalCompositeOperation = 'destination-out';
      U.pathFrom(g, f.contour);
      g.fill();
      p.save();
      p.globalCompositeOperation = 'destination-over';
      p.drawImage(sc, 0, 0);
      p.restore();
    }

    const decos = design.decos || [];
    if (design.gloss > 0.01 || decos.length) {
      p.save();
      p.translate(-x0, -y0);
      U.pathFrom(p, f.contour);
      p.clip();
      p.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
      if (design.gloss > 0.01) drawGloss(p, f, design.gloss);
      decos.forEach((d) => M.drawDeco(p, Object.assign({}, d, { x: d.x * f.W, y: d.y * f.H }), f.W));
      p.restore();
    }
    return { canvas: c, x: x0, y: y0, frame: f };
  }

  function cachedLayer(fid, shape, design, env) {
    if (!design || !shape || shape.points.length < 3) return null;
    const key = env.photoId + '|' + JSON.stringify(shape) + '|' + JSON.stringify(design);
    const hit = layerCache.get(fid);
    if (hit && hit.key === key) return hit.layer;
    const layer = nailLayer(shape, design, env, fid);
    layerCache.set(fid, { key, layer });
    return layer;
  }

  /* 写真全体の合成（表示・書き出し共通。座標は常に作業画像基準） */
  let compCanvas = null;
  function composite(state, env, skipFid) {
    const pw = env.photo.width, ph = env.photo.height;
    if (!compCanvas || compCanvas.width !== pw || compCanvas.height !== ph) compCanvas = U.makeCanvas(pw, ph);
    const ctx = compCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(env.photo, 0, 0);
    U.FINGERS.forEach((F) => {
      const n = state.nails[F.id];
      if (!n || n.skip || F.id === skipFid) return;
      const L = cachedLayer(F.id, n.shape, n.design, env);
      if (L) ctx.drawImage(L.canvas, L.x, L.y);
    });
    return compCanvas;
  }

  // 先端を上にした拡大図
  function closeup(src, frame, w, h, extraLayer) {
    const c = U.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4efe8';
    ctx.fillRect(0, 0, w, h);
    const k = Math.min(w / (frame.W * 1.8), h / (frame.H * 1.45));
    const T = U.imageToUpright(frame, k, w / 2, h / 2);
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0);
    if (extraLayer) ctx.drawImage(extraLayer.canvas, extraLayer.x, extraLayer.y);
    return c;
  }

  function describe(design, state, shape) {
    if (!design) return ['未設定'];
    const out = [];
    if (shape && shape.ext && shape.ext.on) {
      out.push('長さだし: ' + (U.EXT_SHAPES[shape.ext.shape] || U.EXT_SHAPES.oval).name + ' +' + Math.round(shape.ext.length * 100) + '%');
    }
    if (design.presetId) {
      const p = M.PRESETS.find((x) => x.id === design.presetId);
      if (p) out.push('デザイン: ' + p.name);
    }
    out.push('ベース: ' + (design.color ? design.color.toUpperCase() : 'なし'));
    if (design.art) {
      if (design.art.kind === 'pattern') out.push('柄: ' + (M.PATTERN_NAMES[design.art.id] || design.art.id));
      else if (design.art.kind === 'cutout') out.push('柄: 写真から切り抜き（' + ({ shape: '形に沿わせる', stretch: 'B 爪に合わせて変形' }[design.tf.fit] || 'A 比率を保持') + '）');
      else out.push('柄: 読み込んだ素材');
    }
    out.push('不透明度 ' + Math.round(design.opacity * 100) + '%');
    if (design.french && design.french.on) out.push('フレンチ 太さ' + Math.round(design.french.width * 100) + '%');
    if (design.glitter && design.glitter.on) out.push('ラメ風 強さ' + Math.round(design.glitter.amount * 100) + '%');
    if (design.decos && design.decos.length) {
      const cnt = {};
      design.decos.forEach((d) => { const nm = (M.DECOS.find((x) => x.id === d.type) || {}).name || d.type; cnt[nm] = (cnt[nm] || 0) + 1; });
      out.push('装飾: ' + Object.keys(cnt).map((k) => k + '×' + cnt[k]).join('、'));
    }
    return out;
  }

  function wrapText(ctx, text, maxW) {
    const lines = [];
    String(text || '').split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
      }
      lines.push(line);
    });
    return lines;
  }

  /* 相談用シート */
  function sheet(state, env, comp) {
    const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
    const Wd = 1600, M0 = 64;
    const items = U.FINGERS.map((F) => ({ F, n: state.nails[F.id] }))
      .filter((o) => o.n && !o.n.skip && o.n.shape.points.length >= 3);
    const photoMaxW = Wd - M0 * 2, photoMaxH = 1150;
    const k = Math.min(photoMaxW / comp.width, photoMaxH / comp.height);
    const phW = Math.round(comp.width * k), phH = Math.round(comp.height * k);
    const cardW = 276, cardH = 520, gap = (Wd - M0 * 2 - cardW * 5) / 4;
    const meas = U.makeCanvas(10, 10).getContext('2d');
    meas.font = '28px ' + FONT;
    const memoLines = wrapText(meas, state.memo || '（メモなし）', Wd - M0 * 2 - 48);
    const memoH = 90 + memoLines.length * 44;
    const H = M0 + 150 + phH + 60 + (items.length ? cardH + 60 : 0) + memoH + 140;

    const c = U.makeCanvas(Wd, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fbf8f2';
    ctx.fillRect(0, 0, Wd, H);
    let y = M0;
    ctx.fillStyle = '#b14f69';
    ctx.font = '600 26px ' + FONT;
    ctx.fillText('NAIL CONSULTATION', M0, y + 20);
    ctx.fillStyle = '#3a2e31';
    ctx.font = '700 54px ' + FONT;
    ctx.fillText('仕上がりの相談用イメージ', M0, y + 88);
    ctx.font = '26px ' + FONT;
    ctx.fillStyle = '#7d6d70';
    const d = new Date();
    ctx.textAlign = 'right';
    ctx.fillText(d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日', Wd - M0, y + 88);
    ctx.textAlign = 'left';
    y += 150;
    const px = (Wd - phW) / 2;
    ctx.drawImage(comp, px, y, phW, phH);
    ctx.strokeStyle = '#e5d9d3'; ctx.lineWidth = 2;
    ctx.strokeRect(px, y, phW, phH);
    y += phH + 60;

    if (items.length) {
      const startX = M0 + (Wd - M0 * 2 - (cardW * items.length + gap * (items.length - 1))) / 2;
      items.forEach((o, i) => {
        const x = startX + i * (cardW + gap);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, cardW, cardH);
        ctx.strokeStyle = '#eadfd9';
        ctx.strokeRect(x, y, cardW, cardH);
        const f = U.nailFrame(o.n.shape);
        const cu = closeup(comp, f, cardW - 24, 290);
        ctx.drawImage(cu, x + 12, y + 12);
        ctx.fillStyle = '#3a2e31';
        ctx.font = '700 30px ' + FONT;
        ctx.fillText(o.F.name, x + 16, y + 345);
        ctx.font = '20px ' + FONT;
        ctx.fillStyle = '#6b5c60';
        let ly = y + 380;
        describe(o.n.design, state, o.n.shape).forEach((line) => {
          wrapText(ctx, line, cardW - 32).forEach((l) => { if (ly < y + cardH - 12) { ctx.fillText(l, x + 16, ly); ly += 28; } });
        });
      });
      y += cardH + 60;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(M0, y, Wd - M0 * 2, memoH);
    ctx.strokeStyle = '#eadfd9';
    ctx.strokeRect(M0, y, Wd - M0 * 2, memoH);
    ctx.fillStyle = '#b14f69';
    ctx.font = '700 28px ' + FONT;
    ctx.fillText('ご希望メモ', M0 + 24, y + 52);
    ctx.fillStyle = '#3a2e31';
    ctx.font = '28px ' + FONT;
    memoLines.forEach((l, i) => ctx.fillText(l, M0 + 24, y + 100 + i * 44));
    y += memoH + 50;
    ctx.fillStyle = '#7d6d70';
    ctx.font = '22px ' + FONT;
    ctx.fillText('※ 色・柄・配置を相談するためのプレビューです。実際の施術の仕上がりを保証するものではありません。', M0, y);
    if (state.photo && state.photo.demo) ctx.fillText(state.photo.demo === 'photo' ? '※ デモ用のサンプル写真を使用しています。' : '※ 図解デモ画像を使用しています（実写ではありません）。', M0, y + 34);
    return c;
  }

  function clearCaches() { layerCache.clear(); lumCache.clear(); }

  ND.render = { analyzeCutout, artBaseK, drawArtGhost, nailLayer, cachedLayer, composite, closeup, sheet, describe, clearCaches };
})();
