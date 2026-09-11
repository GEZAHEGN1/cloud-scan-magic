import type { BookLayout } from "./booksizes";
import { ensureCanvasFont, ensurePdfFont } from "./fonts";

export type Align = "left" | "center" | "right";

/** Measurements taken from the original page, when it was seen. */
export type Metrics = {
  /** Text height relative to the body text (1 = body). */
  sizeScale?: number | undefined;
  /** First line is indented. */
  indent?: boolean | undefined;
  /** Blank space above the block, in body lines. */
  spaceBefore?: number | undefined;
};

export type Block =
  | ({ type: "heading"; level: 1 | 2 | 3; text: string; align?: Align; bold?: boolean } & Metrics)
  | ({ type: "paragraph"; text: string; align?: Align; bold?: boolean } & Metrics)
  | ({ type: "list"; text: string; align?: Align; bold?: boolean } & Metrics)
  | ({ type: "quote"; text: string; align?: Align; bold?: boolean } & Metrics)
  | ({ type: "toc"; text: string; page?: string; level?: 1 | 2 | 3; bold?: boolean } & Metrics)
  | { type: "pagebreak" };

/** A stretch of text with one weight, produced from **bold** markers. */
export type Run = { text: string; bold: boolean };

/** Splits text with `**bold**` markers into weighted runs. */
export function parseRuns(text: string, baseBold = false): Run[] {
  const runs: Run[] = [];
  const parts = text.split(/\*\*/);
  parts.forEach((part, i) => {
    if (!part) return;
    runs.push({ text: part, bold: baseBold || i % 2 === 1 });
  });
  return runs.length ? runs : [{ text: "", bold: baseBold }];
}

const stripMarks = (t: string) => t.replace(/\*\*/g, "");

/** Fallback structure detection when no AI layout analysis is available. */
export function blocksFromText(text: string): Block[] {
  const out: Block[] = [];
  const paras = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paras) {
    for (const rawLine of p.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      // Table-of-contents style entry: label, filler, trailing page number.
      const toc = line.match(/^(.*?)[\s._\-–—]{3,}\s*(\d{1,4})$/);
      if (toc && toc[1]?.trim()) {
        const label = toc[1].trim();
        out.push({
          type: "toc",
          text: label,
          page: toc[2] ?? "",
          level: /^[\d\u1369-\u137C]+[.)]/.test(label) ? 1 : 2,
        });
        continue;
      }
      if (/^([-*•]|\d+[.)])\s+/.test(line)) {
        out.push({ type: "list", text: line.replace(/^([-*•]|\d+[.)])\s+/, "") });
        continue;
      }
      if (line.length < 70 && !/[.!?]$/.test(line) && p.split("\n").length === 1) {
        out.push({ type: "heading", level: line === line.toUpperCase() ? 1 : 2, text: line });
        continue;
      }
      out.push({ type: "paragraph", text: line });
    }
  }
  return out;
}

type Styled = {
  size: number;
  bold: boolean;
  italic: boolean;
  spaceBefore: number;
  spaceAfter: number;
  indent: number;
  align: Align;
};

function styleFor(block: Block, layout: BookLayout): Styled {
  switch (block.type) {
    case "heading":
      return {
        size: layout.bodySize * (block.level === 1 ? 1.7 : block.level === 2 ? 1.35 : 1.15),
        bold: true,
        italic: false,
        spaceBefore: layout.leading * (block.level === 1 ? 1.6 : 1.1),
        spaceAfter: layout.leading * 0.5,
        indent: 0,
        align: block.align ?? "center",
      };
    case "quote":
      return {
        size: layout.bodySize * 0.95,
        bold: !!block.bold,
        italic: true,
        spaceBefore: layout.leading * 0.6,
        spaceAfter: layout.leading * 0.3,
        indent: 18,
        align: block.align ?? "left",
      };
    case "list":
      return {
        size: layout.bodySize,
        bold: !!block.bold,
        italic: false,
        spaceBefore: layout.leading * 0.2,
        spaceAfter: 0,
        indent: 14,
        align: block.align ?? "left",
      };
    case "toc":
      return {
        size: layout.bodySize * ((block.level ?? 2) === 1 ? 1.05 : 1),
        bold: block.bold ?? (block.level ?? 2) === 1,
        italic: false,
        spaceBefore: layout.leading * ((block.level ?? 2) === 1 ? 0.7 : 0.15),
        spaceAfter: 0,
        indent: (block.level ?? 2) === 1 ? 0 : 16,
        align: "left",
      };
    default:
      return {
        size: layout.bodySize,
        bold: !!(block as { bold?: boolean }).bold,
        italic: false,
        spaceBefore: 0,
        spaceAfter: layout.leading * 0.35,
        indent: 0,
        align: (block as { align?: Align }).align ?? "left",
      };
  }
}

type Measure = (text: string, bold: boolean) => number;

/** Greedy word wrap that keeps per-word weight information. */
function wrapRuns(runs: Run[], maxW: number, measure: Measure): Run[][] {
  const words: Run[] = [];
  for (const run of runs) {
    for (const word of run.text.split(/(\s+)/)) {
      if (word === "") continue;
      words.push({ text: word, bold: run.bold });
    }
  }
  const lines: Run[][] = [];
  let line: Run[] = [];
  let width = 0;
  for (const word of words) {
    const w = measure(word.text, word.bold);
    if (/^\s+$/.test(word.text)) {
      if (line.length) {
        line.push(word);
        width += w;
      }
      continue;
    }
    if (width + w > maxW && line.length) {
      while (line.length && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
      lines.push(line);
      line = [word];
      width = w;
    } else {
      line.push(word);
      width += w;
    }
  }
  if (line.length) {
    while (line.length && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
    lines.push(line);
  }
  return lines.length ? lines : [[]];
}

const lineWidth = (line: Run[], measure: Measure) =>
  line.reduce((sum, r) => sum + measure(r.text, r.bold), 0);

/**
 * Reflows the recognised document into a print-ready book PDF at the chosen
 * trim size, with mirrored inside/outside margins and running page numbers.
 */
export async function renderBookPdf(
  blocks: Block[],
  layout: BookLayout,
  meta: { title: string },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: [layout.pageW, layout.pageH], orientation: "portrait" });
  pdf.setProperties({ title: meta.title });
  const sample = meta.title + " " + blocks.map((b) => ("text" in b ? b.text : "")).join(" ");
  const font = await ensurePdfFont(pdf, sample);

  let pageIndex = 0;
  const contentW = () => layout.pageW - layout.marginInside - layout.marginOutside;
  const leftMargin = () => (pageIndex % 2 === 0 ? layout.marginInside : layout.marginOutside);
  let y = layout.marginTop;

  const setFace = (bold: boolean, italic: boolean, size: number) => {
    pdf.setFont(font, bold ? "bold" : italic && font === "times" ? "italic" : "normal");
    pdf.setFontSize(size);
  };

  const footer = () => {
    if (!layout.pageNumbers) return;
    setFace(false, false, layout.bodySize * 0.8);
    pdf.text(
      String(pageIndex + 1),
      pageIndex % 2 === 0 ? layout.pageW - layout.marginOutside : layout.marginOutside,
      layout.pageH - layout.marginBottom * 0.55,
      { align: pageIndex % 2 === 0 ? "right" : "left" },
    );
  };

  const newPage = () => {
    footer();
    pdf.addPage([layout.pageW, layout.pageH], "portrait");
    pageIndex += 1;
    y = layout.marginTop;
  };

  for (const block of blocks) {
    if (block.type === "pagebreak") {
      if (y > layout.marginTop) newPage();
      continue;
    }
    const s = styleFor(block, layout);
    const measure: Measure = (text, bold) => {
      setFace(bold, s.italic, s.size);
      return pdf.getTextWidth(text);
    };
    const lineH = s.size * 1.42;
    y += s.spaceBefore;

    if (block.type === "toc") {
      const pageLabel = block.page ?? "";
      const pageW = pageLabel ? measure(pageLabel, s.bold) : 0;
      const avail = contentW() - s.indent - (pageW ? pageW + 12 : 0);
      const lines = wrapRuns(parseRuns(block.text, s.bold), avail, measure);
      lines.forEach((line, i) => {
        if (y + lineH > layout.pageH - layout.marginBottom) newPage();
        let x = leftMargin() + s.indent;
        for (const run of line) {
          setFace(run.bold, s.italic, s.size);
          pdf.text(run.text, x, y + s.size);
          x += pdf.getTextWidth(run.text);
        }
        if (i === lines.length - 1 && pageLabel) {
          const right = leftMargin() + contentW();
          setFace(false, false, s.size);
          const dotW = pdf.getTextWidth(".");
          const gapStart = x + 4;
          const gapEnd = right - pageW - 4;
          if (gapEnd > gapStart && dotW > 0) {
            pdf.text(".".repeat(Math.max(0, Math.floor((gapEnd - gapStart) / dotW))), gapStart, y + s.size);
          }
          setFace(s.bold, false, s.size);
          pdf.text(pageLabel, right, y + s.size, { align: "right" });
        }
        y += lineH;
      });
      y += s.spaceAfter;
      continue;
    }

    const prefix = block.type === "list" ? "• " : "";
    const runs = parseRuns(prefix + block.text, s.bold);
    const maxW = contentW() - s.indent;
    const lines = wrapRuns(runs, maxW, measure);
    for (const line of lines) {
      if (y + lineH > layout.pageH - layout.marginBottom) newPage();
      const w = lineWidth(line, measure);
      let x = leftMargin() + s.indent;
      if (s.align === "center") x += (maxW - w) / 2;
      else if (s.align === "right") x += maxW - w;
      for (const run of line) {
        setFace(run.bold, s.italic, s.size);
        pdf.text(run.text, x, y + s.size);
        x += pdf.getTextWidth(run.text);
      }
      y += lineH;
    }
    y += s.spaceAfter;
  }
  footer();
  return pdf.output("blob");
}

/** Draws a preview of the first reconstructed page onto a canvas. */
export async function renderPreview(
  canvas: HTMLCanvasElement,
  blocks: Block[],
  layout: BookLayout,
  title: string,
) {
  const sample = title + " " + blocks.map((b) => ("text" in b ? b.text : "")).join(" ");
  const family = await ensureCanvasFont(sample);
  const scale = Math.min(3, 700 / layout.pageW);
  canvas.width = Math.round(layout.pageW * scale);
  canvas.height = Math.round(layout.pageH * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fdfcf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#14110e";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const left = layout.marginInside * scale;
  const right = canvas.width - layout.marginOutside * scale;
  const maxW = right - left;
  const bottom = canvas.height - layout.marginBottom * scale;
  let y = layout.marginTop * scale;

  if (layout.pageNumbers) {
    ctx.font = `normal ${layout.bodySize * 0.8 * scale}px ${family}`;
    ctx.textAlign = "right";
    ctx.fillText("1", right, canvas.height - layout.marginBottom * 0.55 * scale);
    ctx.textAlign = "left";
  }

  for (const block of blocks) {
    if (block.type === "pagebreak") continue;
    const s = styleFor(block, layout);
    const px = s.size * scale;
    const measure: Measure = (text, bold) => {
      ctx.font = `${bold ? "bold" : s.italic ? "italic" : "normal"} ${px}px ${family}`;
      return ctx.measureText(text).width;
    };
    const lineH = px * 1.42;
    y += s.spaceBefore * scale;

    if (block.type === "toc") {
      const pageLabel = block.page ?? "";
      const pageW = pageLabel ? measure(pageLabel, s.bold) : 0;
      const avail = maxW - s.indent * scale - (pageW ? pageW + 12 * scale : 0);
      const lines = wrapRuns(parseRuns(block.text, s.bold), avail, measure);
      for (let i = 0; i < lines.length; i++) {
        if (y + lineH > bottom) return;
        let x = left + s.indent * scale;
        for (const run of lines[i]!) {
          ctx.font = `${run.bold ? "bold" : "normal"} ${px}px ${family}`;
          ctx.fillText(run.text, x, y);
          x += ctx.measureText(run.text).width;
        }
        if (i === lines.length - 1 && pageLabel) {
          ctx.font = `normal ${px}px ${family}`;
          const dotW = ctx.measureText(".").width;
          const gapStart = x + 4 * scale;
          const gapEnd = right - pageW - 4 * scale;
          if (gapEnd > gapStart && dotW > 0) {
            ctx.fillText(".".repeat(Math.floor((gapEnd - gapStart) / dotW)), gapStart, y);
          }
          ctx.font = `${s.bold ? "bold" : "normal"} ${px}px ${family}`;
          ctx.textAlign = "right";
          ctx.fillText(pageLabel, right, y);
          ctx.textAlign = "left";
        }
        y += lineH;
      }
      y += s.spaceAfter * scale;
      continue;
    }

    const prefix = block.type === "list" ? "• " : "";
    const lines = wrapRuns(parseRuns(prefix + block.text, s.bold), maxW - s.indent * scale, measure);
    for (const line of lines) {
      if (y + lineH > bottom) return;
      const w = lineWidth(line, measure);
      let x = left + s.indent * scale;
      if (s.align === "center") x += (maxW - s.indent * scale - w) / 2;
      else if (s.align === "right") x += maxW - s.indent * scale - w;
      for (const run of line) {
        ctx.font = `${run.bold ? "bold" : s.italic ? "italic" : "normal"} ${px}px ${family}`;
        ctx.fillText(run.text, x, y);
        x += ctx.measureText(run.text).width;
      }
      y += lineH;
    }
    y += s.spaceAfter * scale;
  }
}

export { stripMarks };
