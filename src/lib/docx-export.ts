import type { BookLayout } from "./booksizes";
import { parseRuns, type Block } from "./reconstruct";

/**
 * Rebuilds the recognised document as a Word file at the chosen finished
 * size, matching the page setup used for the print-ready PDF.
 */
export async function renderBookDocx(
  blocks: Block[],
  layout: BookLayout,
  meta: { title: string },
): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    LevelFormat,
    PageBreak,
    TabStopType,
    TabStopPosition,
  } = await import("docx");

  const dxa = (pt: number) => Math.round(pt * 20);
  const body = layout.bodySize * 2; // docx half-points

  const runs = (text: string, size: number, opts: { bold?: boolean; italics?: boolean } = {}) =>
    parseRuns(text, opts.bold ?? false).map(
      (r) => new TextRun({ text: r.text, bold: r.bold, italics: opts.italics ?? false, size }),
    );

  const alignOf = (a?: string) =>
    a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;

  const children = blocks.map((block) => {
    if (block.type === "pagebreak") return new Paragraph({ children: [new PageBreak()] });
    if (block.type === "heading") {
      return new Paragraph({
        heading:
          block.level === 1
            ? HeadingLevel.HEADING_1
            : block.level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        alignment: alignOf(block.align ?? "center"),
        spacing: { before: dxa(layout.leading), after: dxa(layout.leading * 0.4) },
        children: runs(
          block.text,
          Math.round(body * (block.level === 1 ? 1.7 : block.level === 2 ? 1.35 : 1.15)),
          { bold: true },
        ),
      });
    }
    if (block.type === "toc") {
      const level = block.level ?? 2;
      return new Paragraph({
        indent: { left: dxa(level === 1 ? 0 : 16) },
        spacing: { before: dxa(layout.leading * (level === 1 ? 0.7 : 0.15)) },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: "dot" }],
        children: [
          ...runs(block.text, body, { bold: block.bold ?? level === 1 }),
          new TextRun({ text: `\t${block.page ?? ""}`, size: body, bold: block.bold ?? level === 1 }),
        ],
      });
    }
    if (block.type === "list") {
      return new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: runs(block.text, body, { bold: block.bold }),
      });
    }
    if (block.type === "quote") {
      return new Paragraph({
        indent: { left: dxa(18) },
        alignment: alignOf(block.align),
        spacing: { before: dxa(layout.leading * 0.6), after: dxa(layout.leading * 0.3) },
        children: runs(block.text, Math.round(body * 0.95), { bold: block.bold, italics: true }),
      });
    }
    return new Paragraph({
      alignment: alignOf(block.align),
      spacing: { after: dxa(layout.leading * 0.35), line: Math.round(layout.leading * 20) },
      children: runs(block.text, body, { bold: block.bold }),
    });
  });

  const doc = new Document({
    title: meta.title,
    styles: { default: { document: { run: { font: "Times New Roman", size: body } } } },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: dxa(layout.pageW), height: dxa(layout.pageH) },
            margin: {
              top: dxa(layout.marginTop),
              bottom: dxa(layout.marginBottom),
              left: dxa(layout.marginInside),
              right: dxa(layout.marginOutside),
              gutter: 0,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
