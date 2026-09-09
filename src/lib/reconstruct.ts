import type { BookLayout } from "./booksizes";
import { ensureCanvasFont, ensurePdfFont } from "./fonts";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; text: string }
  | { type: "quote"; text: string }
  | { type: "pagebreak" };

/** Fallback structure detection when no AI layout analysis is available. */
export function blocksFromText(text: string): Block[] {
  const out: Block[] = [];
  const paras = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paras) {
    const single = p.split("\n").length === 1;
    if (/^([-*•]|\d+[.)])\s+/.test(p)) {
      for (const line of p.split("\n")) out.push({ type: "list", text: line.replace(/^([-*•]|\d+[.)])\s+/, "") });
    } else if (single && p.length < 70 && !/[.!?]$/.test(p)) {
      out.push({ type: "heading", level: p === p.toUpperCase() ? 1 : 2, text: p });
    } else {
      out.push({ type: "paragraph", text: p.replace(/-\n/g, "").replace(/\n/g, " ") });
    }
  }
  return out;
}

type Styled = { size: number; bold: boolean; italic: boolean; spaceBefore: number; indent: number };

function styleFor(block: Block, layout: BookLayout): Styled {
  switch (block.type) {
    case "heading":
      return {
        size: layout.bodySize * (block.level === 1 ? 1.7 : block.level === 2 ? 1.35 : 1.15),
        bold: true,
        italic: false,
        spaceBefore: layout.leading * (block.level === 1 ? 1.6 : 1.1),
        indent: 0,
      };
    case "quote":
      return { size: layout.bodySize * 0.95, bold: false, italic: true, spaceBefore: layout.leading * 0.6, indent: 18 };
    case "list":
      return { size: layout.bodySize, bold: false, italic: false, spaceBefore: layout.leading * 0.2, indent: 14 };
    default:
      return { size: layout.bodySize, bold: false, italic: false, spaceBefore: 0, indent: 0 };
  }
}

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

  let pageIndex = 0;
  const contentW = () => layout.pageW - layout.marginInside - layout.marginOutside;
  const leftMargin = () => (pageIndex % 2 === 0 ? layout.marginInside : layout.marginOutside);
  let y = layout.marginTop;

  const footer = () => {
    if (!layout.pageNumbers) return;
    pdf.setFont("times", "normal");
    pdf.setFontSize(layout.bodySize * 0.8);
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

  // Title page
  pdf.setFont("times", "bold");
  pdf.setFontSize(layout.bodySize * 2.2);
  pdf.text(pdf.splitTextToSize(meta.title, contentW()), layout.pageW / 2, layout.pageH * 0.38, {
    align: "center",
  });
  newPage();

  for (const block of blocks) {
    if (block.type === "pagebreak") {
      if (y > layout.marginTop) newPage();
      continue;
    }
    const s = styleFor(block, layout);
    pdf.setFont("times", s.bold ? "bold" : s.italic ? "italic" : "normal");
    pdf.setFontSize(s.size);
    const width = contentW() - s.indent;
    const prefix = block.type === "list" ? "• " : "";
    const lines = pdf.splitTextToSize(prefix + block.text, width) as string[];
    const lineH = s.size * 1.42;
    y += s.spaceBefore;
    for (const line of lines) {
      if (y + lineH > layout.pageH - layout.marginBottom) newPage();
      pdf.setFont("times", s.bold ? "bold" : s.italic ? "italic" : "normal");
      pdf.setFontSize(s.size);
      pdf.text(line, leftMargin() + s.indent, y + s.size, { align: "left" });
      y += lineH;
    }
    if (block.type === "paragraph" || block.type === "heading") y += layout.leading * 0.35;
  }
  footer();
  return pdf.output("blob");
}

/** Draws a preview of the first reconstructed page onto a canvas. */
export function renderPreview(canvas: HTMLCanvasElement, blocks: Block[], layout: BookLayout, title: string) {
  const scale = Math.min(3, 700 / layout.pageW);
  canvas.width = Math.round(layout.pageW * scale);
  canvas.height = Math.round(layout.pageH * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fdfcf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#14110e";
  ctx.textBaseline = "top";

  const left = layout.marginInside * scale;
  const right = canvas.width - layout.marginOutside * scale;
  const maxW = right - left;
  let y = layout.marginTop * scale;

  const drawLines = (text: string, size: number, weight: string, indent = 0, prefix = "") => {
    ctx.font = `${weight} ${size * scale}px Georgia, 'Times New Roman', serif`;
    const words = (prefix + text).split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW - indent * scale && line) {
        ctx.fillText(line, left + indent * scale, y);
        y += size * 1.42 * scale;
        line = word;
      } else line = test;
      if (y > canvas.height - layout.marginBottom * scale) return true;
    }
    if (line) {
      ctx.fillText(line, left + indent * scale, y);
      y += size * 1.42 * scale;
    }
    return y > canvas.height - layout.marginBottom * scale;
  };

  if (drawLines(title, layout.bodySize * 1.7, "bold")) return;
  y += layout.leading * scale;
  for (const block of blocks) {
    if (block.type === "pagebreak") continue;
    const s = styleFor(block, layout);
    y += s.spaceBefore * scale;
    const weight = s.bold ? "bold" : s.italic ? "italic" : "normal";
    if (drawLines(block.text, s.size, weight, s.indent, block.type === "list" ? "• " : "")) return;
    y += layout.leading * 0.35 * scale;
  }
}
