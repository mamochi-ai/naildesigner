/* デザイン素材。サンプルはすべてこのアプリ用にプログラムで描いた自作素材。
   将来、掲載許可を得た画像素材を追加する場合は LICENSED_MATERIALS に
   { id, name, credit, license, src } を追加する（src は同梱した透過PNGの相対パス）。 */
(function () {
  'use strict';
  const ND = (window.ND = window.ND || {});
  const U = ND.util;

  function defaultDesign() {
    return {
      color: '#e8a3ad',
      opacity: 1, // 不透明度（下げると透明感が出て元の爪が透ける）
      shadeAmt: 0.65, // 元写真の明暗をどれだけ反映するか
      gloss: 0.35, // 追加の光沢
      thick: 0.35, // 厚み（ふちの明暗と爪の下の影）
      curve: 0.5, // 立体感（爪の丸みに合わせて両側を少し暗くする）
      feather: 1.2, // 縁のなじませ（内側のみ・px）
      art: null, // { kind:'pattern', id, fg } | { kind:'image', assetId, name } | { kind:'cutout', cutoutId }
      tf: { x: 0, y: 0, rot: 0, scale: 1, sx: 1, sy: 1, aspect: 1, flip: false, fit: 'clip' },
      artOpacity: 1,
      french: { on: false, color: '#ffffff', width: 0.28 },
      glitter: { on: false, color: '#d9b26a', amount: 0.5 },
      decos: [],
    };
  }

  /* ---- 柄（透明背景の上に描く。単位は爪の幅 W） ---- */
  function valueNoise(seed) {
    const r = U.rng(seed);
    const N = 64, g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const sm = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = sm(x - xi), yf = sm(y - yi);
      const at = (i, j) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }

  const PATTERNS = {
    dots(ctx, w, h, unit, fg, seed) {
      const step = unit * 0.32, r = unit * 0.07;
      ctx.fillStyle = fg;
      let row = 0;
      for (let y = step / 2; y < h + step; y += step * 0.87, row++) {
        for (let x = (row % 2 ? step / 2 : 0); x < w + step; x += step) {
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
    flowers(ctx, w, h, unit, fg, seed) {
      const r = U.rng(seed || 'flower');
      const step = unit * 0.42;
      for (let gy = 0; gy < h + step; gy += step) {
        for (let gx = 0; gx < w + step; gx += step) {
          const x = gx + (r() - 0.5) * step * 0.7, y = gy + (r() - 0.5) * step * 0.7;
          const s = unit * (0.08 + r() * 0.05), rot = r() * Math.PI;
          ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
          ctx.fillStyle = fg;
          for (let i = 0; i < 5; i++) {
            ctx.rotate((Math.PI * 2) / 5);
            ctx.beginPath(); ctx.ellipse(0, -s * 0.95, s * 0.55, s * 0.85, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#f3d27a';
          ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    },
    marble(ctx, w, h, unit, fg, seed) {
      const n = valueNoise(seed || 'marble');
      const W = Math.ceil(w), H = Math.ceil(h);
      const id = ctx.createImageData(W, H);
      const c = U.hexToRgb(fg);
      const sc = 3 / unit;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x * sc, ny = y * sc;
          const t = n(nx, ny) + 0.5 * n(nx * 2, ny * 2) + 0.25 * n(nx * 4, ny * 4);
          const v = Math.abs(Math.sin((nx * 0.8 + ny * 0.5 + t * 3.2) * 2.2));
          const vein = Math.pow(1 - v, 9);
          const cloud = Math.max(0, n(nx * 0.7 + 10, ny * 0.7) - 0.55) * 0.9;
          const a = Math.min(1, vein * 0.95 + cloud * 0.5);
          const i = (y * W + x) * 4;
          id.data[i] = c.r; id.data[i + 1] = c.g; id.data[i + 2] = c.b; id.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(id, 0, 0);
    },
    lines(ctx, w, h, unit, fg) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, unit * 0.025);
      const step = unit * 0.3;
      for (let x = -h; x < w + h; x += step) {
        ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h * 0.45, 0); ctx.stroke();
      }
    },
  };

  const PATTERN_NAMES = { dots: 'ドット', flowers: '小花', marble: 'マーブル風', lines: '細いライン' };

  // 試着用デザイン（ベース色・柄・フレンチ・ラメの組み合わせ）
  const PRESETS = [
    { id: 'french', name: 'フレンチ', credit: '自作サンプル',
      apply: { color: '#f3d6d3', opacity: 0.6, french: { on: true, color: '#ffffff', width: 0.3 } } },
    { id: 'dots', name: 'ドット', credit: '自作サンプル',
      apply: { color: '#efc0c7', art: { kind: 'pattern', id: 'dots', fg: '#ffffff' } } },
    { id: 'flowers', name: '小花', credit: '自作サンプル',
      apply: { color: '#fbf1ef', art: { kind: 'pattern', id: 'flowers', fg: '#e58aa1' } } },
    { id: 'marble', name: 'マーブル風', credit: '自作サンプル',
      apply: { color: '#f2eee9', art: { kind: 'pattern', id: 'marble', fg: '#8e8496' } } },
    { id: 'glitter', name: 'ラメ風', credit: '自作サンプル',
      apply: { color: '#e6c3bd', glitter: { on: true, color: '#d9b26a', amount: 0.85 } } },
    { id: 'lines', name: '細いライン', credit: '自作サンプル',
      apply: { color: '#f2e4da', art: { kind: 'pattern', id: 'lines', fg: '#c49a45' } } },
  ];

  // 掲載許可を得た素材を追加する場所（今回は空）
  const LICENSED_MATERIALS = [];

  function applyPreset(design, preset) {
    const d = design ? U.clone(design) : defaultDesign();
    const p = U.clone(preset.apply);
    d.art = p.art || null;
    d.color = p.color !== undefined ? p.color : d.color;
    d.opacity = p.opacity !== undefined ? p.opacity : 1;
    d.french = Object.assign(defaultDesign().french, p.french || { on: false });
    d.glitter = Object.assign(defaultDesign().glitter, p.glitter || { on: false });
    d.tf = defaultDesign().tf;
    d.presetId = preset.id;
    return d;
  }

  /* ---- 装飾（2Dの見本表現） ---- */
  const DECOS = [
    { id: 'circle', name: '円' },
    { id: 'heart', name: 'ハート' },
    { id: 'star', name: '星' },
    { id: 'pearl', name: 'パール' },
  ];

  function drawDeco(ctx, d, unit) {
    const s = d.size * unit;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate((d.rot * Math.PI) / 180);
    const base = d.color;
    const g = ctx.createRadialGradient(-s * 0.25, -s * 0.3, s * 0.05, 0, 0, s * 0.75);
    g.addColorStop(0, U.shade(base, 0.6));
    g.addColorStop(0.55, base);
    g.addColorStop(1, U.shade(base, -0.3));
    ctx.fillStyle = g;
    ctx.strokeStyle = U.shade(base, -0.4);
    ctx.lineWidth = Math.max(0.6, s * 0.04);
    ctx.beginPath();
    if (d.type === 'heart') {
      ctx.moveTo(0, s * 0.42);
      ctx.bezierCurveTo(-s * 0.75, -s * 0.05, -s * 0.38, -s * 0.62, 0, -s * 0.22);
      ctx.bezierCurveTo(s * 0.38, -s * 0.62, s * 0.75, -s * 0.05, 0, s * 0.42);
    } else if (d.type === 'star') {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.22 : s * 0.5;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    }
    ctx.fill();
    if (d.type !== 'pearl') ctx.stroke();
    // 小さなハイライト（立体再現ではなく見本の表現）
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.13, -s * 0.16, s * 0.09, s * 0.06, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const COLORS = [
    '#e8a3ad', '#d46a7e', '#b8324f', '#f3d6d3', '#f6e7dc', '#ffffff',
    '#c9a3c7', '#8e8496', '#9fb8d6', '#a7c4a0', '#d9b26a', '#3b2f33',
  ];

  ND.materials = {
    defaultDesign, PATTERNS, PATTERN_NAMES, PRESETS, LICENSED_MATERIALS, applyPreset, DECOS, drawDeco, COLORS,
  };
})();
