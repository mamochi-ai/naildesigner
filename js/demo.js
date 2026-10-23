/* デモ素材（すべてプログラムで描いた図解。実写ではない） */
(function () {
  'use strict';
  const ND = (window.ND = window.ND || {});
  const U = ND.util;

  function nailOutline(cx, cy, dir, w, l, n) {
    // dir: 根元→先端の単位ベクトル。超楕円で爪らしい形を作る
    const u = { x: -dir.y, y: dir.x };
    const pts = [];
    n = n || 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const px = Math.sign(c) * Math.pow(Math.abs(c), 0.62) * (w / 2);
      const py = Math.sign(s) * Math.pow(Math.abs(s), s > 0 ? 0.75 : 0.95) * (l / 2);
      pts.push({ x: cx + u.x * px + dir.x * py, y: cy + u.y * px + dir.y * py });
    }
    return pts;
  }

  function drawFinger(ctx, base, tip, w) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#c89479';
    ctx.lineWidth = w + 6;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = '#e6bea2';
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    const dx = tip.x - base.x, dy = tip.y - base.y, L = Math.hypot(dx, dy);
    const ux = -dy / L, uy = dx / L;
    ctx.strokeStyle = 'rgba(255,240,228,0.55)';
    ctx.lineWidth = w * 0.22;
    ctx.beginPath();
    ctx.moveTo(base.x - ux * w * 0.18, base.y - uy * w * 0.18);
    ctx.lineTo(tip.x - ux * w * 0.18, tip.y - uy * w * 0.18);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,110,90,0.45)';
    ctx.lineWidth = 2;
    [0.42, 0.47].forEach((t) => {
      const mx = base.x + dx * t, my = base.y + dy * t;
      ctx.beginPath();
      ctx.moveTo(mx - ux * w * 0.25, my - uy * w * 0.25);
      ctx.quadraticCurveTo(mx + (dx / L) * 6, my + (dy / L) * 6, mx + ux * w * 0.25, my + uy * w * 0.25);
      ctx.stroke();
    });
  }

  function drawNail(ctx, cx, cy, dir, w, l) {
    const pts = nailOutline(cx, cy, dir, w, l, 60);
    ctx.save();
    U.pathFrom(ctx, pts);
    ctx.fillStyle = '#e9b0aa';
    ctx.fill();
    ctx.clip();
    const tip = { x: cx + dir.x * l / 2, y: cy + dir.y * l / 2 };
    const base = { x: cx - dir.x * l / 2, y: cy - dir.y * l / 2 };
    const g = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
    g.addColorStop(0, 'rgba(250,225,220,0.9)');
    g.addColorStop(0.16, 'rgba(236,180,174,0.0)');
    g.addColorStop(0.78, 'rgba(236,180,174,0.0)');
    g.addColorStop(0.83, 'rgba(248,238,230,0.95)');
    g.addColorStop(1, 'rgba(250,244,238,1)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 200, cy - 200, 400, 400);
    const u = { x: -dir.y, y: dir.x };
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = w * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - u.x * w * 0.22 - dir.x * l * 0.25, cy - u.y * w * 0.22 - dir.y * l * 0.25);
    ctx.lineTo(cx - u.x * w * 0.22 + dir.x * l * 0.22, cy - u.y * w * 0.22 + dir.y * l * 0.22);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(170,110,100,0.6)';
    ctx.lineWidth = 2;
    U.pathFrom(ctx, pts);
    ctx.stroke();
  }

  function sampleShape(cx, cy, dir, w, l, n) {
    const pts = nailOutline(cx, cy, dir, w * 0.97, l * 0.97, n || 9);
    return {
      points: pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      base: { x: cx - dir.x * l * 0.44, y: cy - dir.y * l * 0.44 },
      tip: { x: cx + dir.x * l * 0.44, y: cy + dir.y * l * 0.44 },
      smooth: 0.6,
    };
  }

  /* 図解の手（右手の甲側）。3本は輪郭入り、2本は自分で輪郭を置いて試せる */
  function hand() {
    const W = 1200, H = 1500;
    const c = U.makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#efe9e2'); bg.addColorStop(1, '#ddd4cb');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const fingers = [
      { id: 'thumb', base: { x: 360, y: 1170 }, tip: { x: 175, y: 870 }, w: 128 },
      { id: 'index', base: { x: 455, y: 960 }, tip: { x: 405, y: 430 }, w: 112 },
      { id: 'middle', base: { x: 595, y: 930 }, tip: { x: 598, y: 335 }, w: 116 },
      { id: 'ring', base: { x: 735, y: 960 }, tip: { x: 782, y: 432 }, w: 108 },
      { id: 'pinky', base: { x: 860, y: 1040 }, tip: { x: 962, y: 665 }, w: 92 },
    ];
    ctx.fillStyle = '#c89479';
    ctx.beginPath(); ctx.ellipse(615, 1270, 345, 330, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6bea2';
    ctx.beginPath(); ctx.ellipse(615, 1270, 340, 325, 0, 0, Math.PI * 2); ctx.fill();
    fingers.forEach((f) => drawFinger(ctx, f.base, f.tip, f.w));
    ctx.fillStyle = '#e6bea2';
    ctx.beginPath(); ctx.ellipse(615, 1240, 300, 250, 0, 0, Math.PI * 2); ctx.fill();
    const shapes = {};
    fingers.forEach((f) => {
      const dx = f.tip.x - f.base.x, dy = f.tip.y - f.base.y, L = Math.hypot(dx, dy);
      const dir = { x: dx / L, y: dy / L };
      const nw = f.w * 0.74, nl = f.w * 0.98;
      const cx = f.tip.x + dir.x * (f.w * 0.5 - nl * 0.5 - 6), cy = f.tip.y + dir.y * (f.w * 0.5 - nl * 0.5 - 6);
      drawNail(ctx, cx, cy, dir, nw, nl);
      shapes[f.id] = sampleShape(cx, cy, dir, nw, nl, f.id === 'middle' ? 10 : 9);
    });
    ctx.fillStyle = 'rgba(70,55,58,0.75)';
    ctx.font = '600 34px "Hiragino Sans", sans-serif';
    ctx.fillText('図解デモ（実写ではありません）', 40, 70);
    return { canvas: c, shapes, preset: ['index', 'middle', 'ring'] };
  }

  /* 図解の参考ネイル（写真から試す用）。光沢の描き込みもあえて残している */
  function reference() {
    const W = 900, H = 900;
    const c = U.makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f1ece6'; ctx.fillRect(0, 0, W, H);
    const base = { x: 560, y: 900 }, tip = { x: 410, y: 300 }, fw = 300;
    drawFinger(ctx, base, tip, fw);
    const dx = tip.x - base.x, dy = tip.y - base.y, L = Math.hypot(dx, dy);
    const dir = { x: dx / L, y: dy / L }, u = { x: -dir.y, y: dir.x };
    const nw = fw * 0.74, nl = fw * 0.98;
    const cx = tip.x + dir.x * (fw * 0.5 - nl * 0.5 - 10), cy = tip.y + dir.y * (fw * 0.5 - nl * 0.5 - 10);
    const pts = nailOutline(cx, cy, dir, nw, nl, 60);
    ctx.save();
    U.pathFrom(ctx, pts); ctx.clip();
    const bt = { x: cx + dir.x * nl / 2, y: cy + dir.y * nl / 2 }, bb = { x: cx - dir.x * nl / 2, y: cy - dir.y * nl / 2 };
    const g = ctx.createLinearGradient(bb.x, bb.y, bt.x, bt.y);
    g.addColorStop(0, '#f7e3df'); g.addColorStop(1, '#d97a8e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = U.rng('ref');
    for (let i = 0; i < 7; i++) {
      const t = r() * 0.8 - 0.4, s = r() * 1.2 - 0.6;
      const fx = cx + dir.x * nl * t + u.x * nw * s * 0.6, fy = cy + dir.y * nl * t + u.y * nw * s * 0.6;
      const sz = 18 + r() * 16;
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(r() * 3);
      ctx.fillStyle = i % 2 ? '#ffffff' : '#fbd0d8';
      for (let k = 0; k < 5; k++) { ctx.rotate(Math.PI * 0.4); ctx.beginPath(); ctx.ellipse(0, -sz, sz * 0.55, sz * 0.85, 0, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#e8b64c'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.35, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#c99b3d'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - u.x * nw + dir.x * nl * 0.1, cy - u.y * nw + dir.y * nl * 0.1);
    ctx.lineTo(cx + u.x * nw + dir.x * nl * 0.3, cy + u.y * nw + dir.y * nl * 0.3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = nw * 0.1; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - u.x * nw * 0.25 - dir.x * nl * 0.3, cy - u.y * nw * 0.25 - dir.y * nl * 0.3);
    ctx.lineTo(cx - u.x * nw * 0.25 + dir.x * nl * 0.2, cy - u.y * nw * 0.25 + dir.y * nl * 0.2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(70,55,58,0.75)';
    ctx.font = '600 30px "Hiragino Sans", sans-serif';
    ctx.fillText('図解の参考ネイル（デモ・実写ではありません）', 30, 56);
    return { canvas: c, shape: sampleShape(cx, cy, dir, nw, nl, 10) };
  }

  /* 一覧の見本用：小さな指1本 */
  let sample = null;
  function sampleFinger() {
    if (sample) return sample;
    const W = 150, H = 190;
    const c = U.makeCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#f2ece5'; ctx.fillRect(0, 0, W, H);
    drawFinger(ctx, { x: 75, y: 240 }, { x: 75, y: 70 }, 100);
    const dir = { x: 0, y: -1 };
    drawNail(ctx, 75, 60, dir, 72, 92);
    sample = { canvas: c, shape: sampleShape(75, 60, dir, 72, 92, 12) };
    return sample;
  }

  ND.demo = { hand, reference, sampleFinger };
})();
