import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TRIM_SIZES, buildLayout, type TrimSize } from "@/lib/booksizes";
import { blocksFromText, renderBookPdf, renderPreview, type Block } from "@/lib/reconstruct";
import { analyzeLayout, analyzePageLayout } from "@/lib/scans.functions";

type Props = {
  title: string;
  fileBase: string;
  /** Recognised text of each page, in order. */
  pageTexts: string[];
  /** Image of each page, in order — used to copy the original layout. */
  pageImages?: string[];
  /** Fallback image when the first page has no image in pageImages. */
  beforeUrl: string | undefined;
};

type AiBlock = {
  type: "heading" | "paragraph" | "list" | "quote" | "toc" | "pagebreak";
  level?: 1 | 2 | 3 | undefined;
  text: string;
  page?: string | undefined;
  align?: "left" | "center" | "right" | undefined;
  bold?: boolean | undefined;
  sizeScale?: number | undefined;
  indent?: boolean | undefined;
  spaceBefore?: number | undefined;
};

/** Turns one AI-described piece of the page into a drawable block. */
function toBlock(b: AiBlock): Block {
  if (b.type === "pagebreak") return { type: "pagebreak" };
  const metrics = {
    sizeScale: b.sizeScale,
    indent: b.indent,
    spaceBefore: b.spaceBefore,
  };
  if (b.type === "heading")
    return {
      type: "heading",
      level: (b.level ?? 2) as 1 | 2 | 3,
      text: b.text,
      align: b.align ?? "center",
      bold: b.bold ?? true,
      ...metrics,
    };
  if (b.type === "toc")
    return {
      type: "toc",
      text: b.text,
      page: b.page ?? "",
      level: (b.level ?? 2) as 1 | 2 | 3,
      bold: b.bold ?? false,
      ...metrics,
    };
  return { type: b.type, text: b.text, align: b.align ?? "left", bold: b.bold ?? false, ...metrics };
}

/**
 * Rebuilds the recognised document as a print-ready book at a chosen trim
 * size, with a before/after comparison of the original photo and the
 * reconstructed page.
 */
export function ReconstructPanel({ title, fileBase, pageTexts, pageImages, beforeUrl }: Props) {
  const [trimId, setTrimId] = useState<string>("kdp-6x9");
  const [bodySize, setBodySize] = useState(11);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [pageLayouts, setPageLayouts] = useState<Block[][] | null>(null);
  const [layoutSources, setLayoutSources] = useState<("ai" | "text")[] | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputSignature = JSON.stringify([pageImages, pageTexts, beforeUrl]);
  const previousInput = useRef(inputSignature);

  useEffect(() => {
    if (previousInput.current === inputSignature) return;
    previousInput.current = inputSignature;
    setBlocks(null);
    setPageLayouts(null);
    setLayoutSources(null);
  }, [inputSignature]);

  const trim: TrimSize = TRIM_SIZES.find((t) => t.id === trimId) ?? TRIM_SIZES[3]!;
  const sourceText = pageTexts.filter(Boolean).join("\n\n");
  const layout = buildLayout(trim, { pageCount: Math.max(24, pageTexts.length * 2), bodySize, pageNumbers });

  const pageCount = Math.max(pageTexts.length, pageImages?.length ?? 0, beforeUrl ? 1 : 0);
  const activePage = Math.min(selectedPage, Math.max(0, pageCount - 1));
  const original = pageImages?.[activePage] || (activePage === 0 ? beforeUrl : undefined);
  // A page preview must contain only its own blocks, not the whole document.
  const preview = pageLayouts?.[activePage] ?? (pageTexts[activePage]?.trim() ? blocksFromText(pageTexts[activePage]) : null);
  const guessed = layoutSources?.[activePage] === "ai";

  function joinPages(pages: Block[][]): Block[] {
    return pages.flatMap((page, index) => index ? [{ type: "pagebreak" as const }, ...page] : page);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!cancelled) await renderPreview(canvas, preview, layout, title);
      } catch {
        /* preview is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLayouts, activePage, pageTexts, trimId, bodySize, pageNumbers, title]);

  const images = pageImages ?? [];

  async function reconstruct() {
    if (!sourceText && !images.some(Boolean)) {
      toast.error("Add a page first.");
      return;
    }
    try {
      let mapped: Block[] = [];
      const perPage: Block[][] = [];
      const sources: ("ai" | "text")[] = [];

      if (images.some(Boolean)) {
        // Look at each photographed page so weight, size, alignment,
        // indentation and spacing come from the original, not from guesswork.
        for (let i = 0; i < pageCount; i++) {
          const imageUrl = images[i] || (i === 0 ? beforeUrl : undefined);
          const text = pageTexts[i]?.trim();
          if (!imageUrl) {
            perPage.push(text ? blocksFromText(text) : []);
            sources.push("text");
            continue;
          }
          setBusy(
            pageCount > 1
              ? `Reading the layout of page ${i + 1} of ${pageCount}…`
              : "Reading the original layout…",
          );
          const { blocks: got } = await analyzePageLayout({
            data: { imageUrl, ...(text ? { text } : {}) },
          });
          perPage.push(got.length ? got.map(toBlock) : text ? blocksFromText(text) : []);
          sources.push(got.length ? "ai" : "text");
        }
        mapped = joinPages(perPage);
      }

      if (!mapped.length && sourceText) {
        setBusy("Rebuilding from the recognised text…");
        if (pageCount === 1) {
          const { blocks: got } = await analyzeLayout({ data: { text: sourceText } });
          perPage.push(got.length ? got.map(toBlock) : blocksFromText(sourceText));
          sources.push("text");
        } else {
          pageTexts.forEach((text) => {
            perPage.push(blocksFromText(text));
            sources.push("text");
          });
        }
        mapped = joinPages(perPage);
      }

      if (!mapped.length) {
        toast.error("Could not read the layout of this page.");
        return;
      }
      setBlocks(mapped);
      setPageLayouts(perPage);
      setLayoutSources(sources);
      toast.success("Document rebuilt");
    } catch (e) {
      if (sourceText) {
        const fallbackPages = pageTexts.map((text) => blocksFromText(text));
        setBlocks(joinPages(fallbackPages));
        setPageLayouts(fallbackPages);
        setLayoutSources(fallbackPages.map(() => "text"));
        toast.error(
          e instanceof Error ? `${e.message} Rebuilt from the text instead.` : "Rebuilt from the text instead.",
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Could not rebuild the document");
      }
    } finally {
      setBusy(null);
    }
  }

  async function exportFile(kind: "pdf" | "docx") {
    const use = blocks ?? (sourceText ? joinPages(pageTexts.map((text) => blocksFromText(text))) : null);
    if (!use) {
      toast.error("Nothing to export yet.");
      return;
    }
    setBusy(kind === "pdf" ? "Building the print-ready PDF…" : "Building the Word file…");
    try {
      const blob =
        kind === "pdf"
          ? await renderBookPdf(use, layout, { title })
          : await (await import("@/lib/docx-export")).renderBookDocx(use, layout, { title });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}-${trim.id}.${kind}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface mb-4 p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-bold">
        <BookOpen className="h-4 w-4 text-primary" /> Rebuild as a book
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reflows your pages onto clean, print-ready pages at the size your printer expects.
      </p>

      <label className="mt-4 block text-sm font-medium" htmlFor="trim-size">
        Finished size
      </label>
      <select
        id="trim-size"
        value={trimId}
        onChange={(e) => setTrimId(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
      >
        {TRIM_SIZES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.provider} · {t.label}
          </option>
        ))}
      </select>

      <label className="mt-4 block text-sm font-medium" htmlFor="body-size">
        Text size ({bodySize}pt)
      </label>
      <input
        id="body-size"
        type="range"
        min={9}
        max={14}
        step={0.5}
        value={bodySize}
        onChange={(e) => setBodySize(Number(e.target.value))}
        className="mt-1 w-full accent-primary"
      />

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={pageNumbers}
          onChange={(e) => setPageNumbers(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Add page numbers
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={reconstruct} disabled={!!busy}>
          <Sparkles className="mr-2 h-4 w-4" /> {blocks ? "Rebuild again" : "Rebuild"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => exportFile("pdf")} disabled={!!busy || !sourceText}>
          <Download className="mr-2 h-4 w-4" /> PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={() => exportFile("docx")} disabled={!!busy || !sourceText}>
          <Download className="mr-2 h-4 w-4" /> Word
        </Button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
        <h3 className="font-display text-sm font-semibold">Layout comparison</h3>
        {pageCount > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Comparison page">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={activePage === 0} onClick={() => setSelectedPage(activePage - 1)} aria-label="Previous page" title="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-14 text-center tabular-nums">{activePage + 1} / {pageCount}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={activePage === pageCount - 1} onClick={() => setSelectedPage(activePage + 1)} aria-label="Next page" title="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 items-start gap-2 sm:gap-4">
        <figure className="min-w-0">
          <figcaption className="mb-2 text-xs font-medium text-muted-foreground">Original page</figcaption>
          {original ? (
            <img src={original} alt={`Original page ${activePage + 1}`} className="block w-full bg-paper object-contain" />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">No page image</div>
          )}
        </figure>
        <figure className="min-w-0">
          <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{guessed ? "AI-guessed layout" : "Text-only preview"}</figcaption>
          {preview ? (
            <canvas ref={canvasRef} aria-label={`Rebuilt page ${activePage + 1}`} className="block w-full bg-paper" />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center bg-muted p-3 text-center text-xs text-muted-foreground">
              Rebuild this page to compare its layout
            </div>
          )}
        </figure>
      </div>
      {pageLayouts?.[activePage]?.length ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{guessed ? "Detected on this page" : "Inferred from text only"}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
            <span>{pageLayouts[activePage].filter((b) => b.type === "heading").length} headings</span>
            <span>{pageLayouts[activePage].filter((b) => b.type !== "pagebreak" && "bold" in b && (b.bold || b.text.includes("**"))).length} with bold text</span>
            <span>{pageLayouts[activePage].filter((b) => b.type !== "pagebreak" && "align" in b && b.align === "center").length} centered blocks</span>
          </div>
        </div>
      ) : null}

      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> {busy}
        </p>
      )}
    </section>
  );
}
