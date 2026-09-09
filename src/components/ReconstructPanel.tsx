import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TRIM_SIZES, buildLayout, type TrimSize } from "@/lib/booksizes";
import { blocksFromText, renderBookPdf, renderPreview, type Block } from "@/lib/reconstruct";
import { analyzeLayout } from "@/lib/scans.functions";

type Props = {
  title: string;
  fileBase: string;
  /** Recognised text of each page, in order. */
  pageTexts: string[];
  /** First scanned page image, shown as the "before" side. */
  beforeUrl: string | undefined;
};

/**
 * Rebuilds the recognised document as a print-ready book at a chosen trim
 * size, with a before/after comparison of the original photo and the
 * reconstructed page.
 */
export function ReconstructPanel({ title, fileBase, pageTexts, beforeUrl }: Props) {
  const [trimId, setTrimId] = useState<string>("kdp-6x9");
  const [bodySize, setBodySize] = useState(11);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const trim: TrimSize = TRIM_SIZES.find((t) => t.id === trimId) ?? TRIM_SIZES[3]!;
  const sourceText = pageTexts.filter(Boolean).join("\n\n");
  const layout = buildLayout(trim, { pageCount: Math.max(24, pageTexts.length * 2), bodySize, pageNumbers });

  // Preview the rebuilt page as soon as there is any recognised text, using
  // the AI structure when it is available and a plain-text pass before that.
  const preview = blocks ?? (sourceText ? blocksFromText(sourceText) : null);

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
  }, [blocks, sourceText, trimId, bodySize, pageNumbers, title]);

  async function reconstruct() {
    if (!sourceText) {
      toast.error("Read the text of at least one page first.");
      return;
    }
    setBusy("Reconstructing the document…");
    try {
      const { blocks: got } = await analyzeLayout({ data: { text: sourceText } });
      const mapped: Block[] = got.length
        ? got.map((b) =>
            b.type === "pagebreak"
              ? { type: "pagebreak" }
              : b.type === "heading"
                ? { type: "heading", level: (b.level ?? 2) as 1 | 2 | 3, text: b.text }
                : { type: b.type, text: b.text },
          )
        : blocksFromText(sourceText);
      setBlocks(mapped);
      toast.success("Document rebuilt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rebuild the document");
    } finally {
      setBusy(null);
    }
  }

  async function exportFile(kind: "pdf" | "docx") {
    const use = blocks ?? (sourceText ? blocksFromText(sourceText) : null);
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
        <Button size="sm" variant="secondary" onClick={exportPdf} disabled={!!busy || !sourceText}>
          <Download className="mr-2 h-4 w-4" /> Print-ready PDF
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Before</figcaption>
          {beforeUrl ? (
            <img src={beforeUrl} alt="Original photographed page" className="w-full rounded-lg bg-paper" />
          ) : (
            <div className="aspect-[3/4] w-full rounded-lg bg-muted" />
          )}
        </figure>
        <figure>
          <figcaption className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">After</figcaption>
          {preview ? (
            <canvas ref={canvasRef} className="w-full rounded-lg bg-paper" />
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
              Read the text of a page to see the rebuilt version
            </div>
          )}
        </figure>
      </div>

      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> {busy}
        </p>
      )}
    </section>
  );
}
