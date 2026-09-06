export type Pt = { x: number; y: number };

/** Four corners plus mid-edge control points for book-curve correction. */
export type Quad = {
  tl: Pt;
  tr: Pt;
  br: Pt;
  bl: Pt;
  tm: Pt;
  bm: Pt;
};

export function defaultQuad(w: number, h: number): Quad {
  const mx = w * 0.06;
  const my = h * 0.06;
  return {
    tl: { x: mx, y: my },
    tr: { x: w - mx, y: my },
    br: { x: w - mx, y: h - my },
    bl: { x: mx, y: h - my },
    tm: { x: w / 2, y: my },
    bm: { x: w / 2, y: h - my },
  };
}

export function normalizeMids(q: Quad): Quad {
  return {
    ...q,
    tm: { x: (q.tl.x + q.tr.x) / 2, y: (q.tl.y + q.tr.y) / 2 },
    bm: { x: (q.bl.x + q.br.x) / 2, y: (q.bl.y + q.br.y) / 2 },
  };
}

function quadBezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const mt = 1 - t;
  // p1 is derived so the curve actually passes through the mid control point.
  const cx = 2 * p1.x - 0.5 * (p0.x + p2.x);
  const cy = 2 * p1.y - 0.5 * (p0.y + p2.y);
  return {
    x: mt * mt * p0.x + 2 * mt * t * cx + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * cy + t * t * p2.y,
  };
}

/**
 * Detects the page area by looking for where content starts relative to the
 * frame border. Returns a straight quad the user can then fine-tune.
 */
export function autoDetectQuad(source: HTMLCanvasElement): Quad {
  const W = source.width;
  const H = source.height;
  const sw = 160;
  const sh = Math.max(1, Math.round((H / W) * sw));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(source, 0, 0, sw, sh);
  const { data } = sctx.getImageData(0, 0, sw, sh);
  const lum = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Page is usually the brightest large region: threshold at midpoint between
  // the darkest background and the brightest paper.
  let min = 255;
  let max = 0;
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] < min) min = lum[i];
    if (lum[i] > max) max = lum[i];
  }
  const thr = min + (max - min) * 0.45;

  let left = sw;
  let right = 0;
  let top = sh;
  let bottom = 0;
  for (let y = 0; y < sh; y++) {
    let run = 0;
    for (let x = 0; x < sw; x++) {
      if (lum[y * sw + x] > thr) run++;
    }
    if (run > sw * 0.25) {
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  for (let x = 0; x < sw; x++) {
    let run = 0;
    for (let y = 0; y < sh; y++) {
      if (lum[y * sw + x] > thr) run++;
    }
    if (run > sh * 0.25) {
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (right - left < sw * 0.2 || bottom - top < sh * 0.2) {
    return defaultQuad(W, H);
  }
  const kx = W / sw;
  const ky = H / sh;
  const x0 = left * kx;
  const x1 = right * kx;
  const y0 = top * ky;
  const y1 = bottom * ky;
  return normalizeMids({
    tl: { x: x0, y: y0 },
    tr: { x: x1, y: y0 },
    br: { x: x1, y: y1 },
    bl: { x: x0, y: y1 },
    tm: { x: (x0 + x1) / 2, y: y0 },
    bm: { x: (x0 + x1) / 2, y: y1 },
  });
}

/**
 * Maps the (possibly curved) page area onto a flat rectangle. Bilinear
 * sampling between a top and a bottom curve flattens book page curl.
 */
export function dewarp(source: HTMLCanvasElement, quad: Quad, maxWidth = 1600): HTMLCanvasElement {
  const wTop = Math.hypot(quad.tr.x - quad.tl.x, quad.tr.y - quad.tl.y);
  const wBot = Math.hypot(quad.br.x - quad.bl.x, quad.br.y - quad.bl.y);
  const hL = Math.hypot(quad.bl.x - quad.tl.x, quad.bl.y - quad.tl.y);
  const hR = Math.hypot(quad.br.x - quad.tr.x, quad.br.y - quad.tr.y);
  let outW = Math.round(Math.max(wTop, wBot));
  let outH = Math.round(Math.max(hL, hR));
  const scale = Math.min(1, maxWidth / Math.max(1, outW));
  outW = Math.max(1, Math.round(outW * scale));
  outH = Math.max(1, Math.round(outH * scale));

  const sctx = source.getContext("2d", { willReadFrequently: true })!;
  const src = sctx.getImageData(0, 0, source.width, source.height);
  const out = new ImageData(outW, outH);
  const sw = source.width;
  const sh = source.height;

  for (let j = 0; j < outH; j++) {
    const v = j / (outH - 1 || 1);
    for (let i = 0; i < outW; i++) {
      const u = i / (outW - 1 || 1);
      const top = quadBezier(quad.tl, quad.tm, quad.tr, u);
      const bot = quadBezier(quad.bl, quad.bm, quad.br, u);
      const sx = top.x + (bot.x - top.x) * v;
      const sy = top.y + (bot.y - top.y) * v;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const di = (j * outW + i) * 4;
      for (let c = 0; c < 3; c++) {
        const p00 = src.data[(y0 * sw + x0) * 4 + c];
        const p10 = src.data[(y0 * sw + x1) * 4 + c];
        const p01 = src.data[(y1 * sw + x0) * 4 + c];
        const p11 = src.data[(y1 * sw + x1) * 4 + c];
        out.data[di + c] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
      out.data[di + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  canvas.getContext("2d")!.putImageData(out, 0, 0);
  return canvas;
}

export type EnhanceMode = "original" | "auto" | "gray" | "bw";

/** Estimates uneven lighting by heavily blurring a downscaled copy. */
function illumination(canvas: HTMLCanvasElement): { data: Float32Array; w: number; h: number } {
  const w = 48;
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  let field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    field[i] = Math.max(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]);
  }
  // Two box-blur passes ~ gaussian.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(w * h);
    const r = 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            sum += field[ny * w + nx];
            n++;
          }
        }
        next[y * w + x] = sum / n;
      }
    }
    field = next;
  }
  return { data: field, w, h };
}

function sampleField(f: { data: Float32Array; w: number; h: number }, u: number, v: number) {
  const x = Math.min(f.w - 1, Math.max(0, u * (f.w - 1)));
  const y = Math.min(f.h - 1, Math.max(0, v * (f.h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(f.w - 1, x0 + 1);
  const y1 = Math.min(f.h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  return (
    f.data[y0 * f.w + x0] * (1 - fx) * (1 - fy) +
    f.data[y0 * f.w + x1] * fx * (1 - fy) +
    f.data[y1 * f.w + x0] * (1 - fx) * fy +
    f.data[y1 * f.w + x1] * fx * fy
  );
}

/** Removes shadows/uneven light, then applies the chosen look. */
export function enhance(canvas: HTMLCanvasElement, mode: EnhanceMode): HTMLCanvasElement {
  if (mode === "original") return canvas;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const field = illumination(canvas);

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1 || 1);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1 || 1);
      const bg = Math.max(40, sampleField(field, u, v));
      const i = (y * w + x) * 4;
      let r = (img.data[i] / bg) * 255;
      let g = (img.data[i + 1] / bg) * 255;
      let b = (img.data[i + 2] / bg) * 255;
      // Contrast stretch around paper white.
      const lift = (val: number) => {
        const t = (val - 150) / 105;
        return Math.max(0, Math.min(255, 255 * Math.max(0, Math.min(1, t * 1.15 + 0.12))));
      };
      r = lift(r);
      g = lift(g);
      b = lift(b);
      if (mode === "gray" || mode === "bw") {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const val = mode === "bw" ? (l > 150 ? 255 : 0) : l;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      } else {
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
      }
    }
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

export function rotateCanvas(canvas: HTMLCanvasElement, deg: 90 | -90): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.height;
  out.height = canvas.width;
  const ctx = out.getContext("2d")!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/jpeg", quality),
  );
}

export function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxSide = 2200;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}
