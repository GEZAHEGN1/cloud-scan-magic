import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Copy, Download, FileText, Loader2, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/doc/$docId")({
  head: () => ({
    meta: [
      { title: "Scan details — Flatlay" },
      { name: "description", content: "View your scanned pages, copy the recognised text and download a PDF." },
      { property: "og:title", content: "Scan details — Flatlay" },
      { property: "og:description", content: "View your scanned pages, copy the text and download a PDF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocPage,
});

type PageRow = {
  id: string;
  position: number;
  storage_path: string;
  ocr_text: string | null;
  url: string;
};

function DocPage() {
  const { docId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["document", docId],
    queryFn: async () => {
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .select("id, title, created_at")
        .eq("id", docId)
        .single();
      if (docErr) throw docErr;

      const { data: rows, error: pagesErr } = await supabase
        .from("pages")
        .select("id, position, storage_path, ocr_text")
        .eq("document_id", docId)
        .order("position", { ascending: true });
      if (pagesErr) throw pagesErr;

      const paths = (rows ?? []).map((r) => r.storage_path);
      const signed = paths.length
        ? (await supabase.storage.from("scans").createSignedUrls(paths, 3600)).data ?? []
        : [];
      const pages: PageRow[] = (rows ?? []).map((r, i) => ({
        ...r,
        url: signed[i]?.signedUrl ?? "",
      }));
      return { doc, pages };
    },
  });

  const rename = useMutation({
    mutationFn: async (next: string) => {
      const { error } = await supabase.from("documents").update({ title: next }).eq("id", docId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name saved");
      void qc.invalidateQueries({ queryKey: ["document", docId] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function deletePage(page: PageRow) {
    setBusy("Removing page…");
    try {
      await supabase.storage.from("scans").remove([page.storage_path]);
      const { error } = await supabase.from("pages").delete().eq("id", page.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["document", docId] });
      await qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Page removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that page");
    } finally {
      setBusy(null);
    }
  }

  async function deleteDoc() {
    if (!data) return;
    setBusy("Deleting scan…");
    try {
      const paths = data.pages.map((p) => p.storage_path);
      if (paths.length) await supabase.storage.from("scans").remove(paths);
      await supabase.from("pages").delete().eq("document_id", docId);
      const { error } = await supabase.from("documents").delete().eq("id", docId);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Scan deleted");
      navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the scan");
    } finally {
      setBusy(null);
    }
  }

  async function buildPdf(): Promise<Blob | null> {
    if (!data?.pages.length) return null;
    const { jsPDF } = await import("jspdf");
    let pdf: import("jspdf").jsPDF | null = null;

    for (const page of data.pages) {
      const img = await loadImage(page.url);
      const orientation = img.width > img.height ? "landscape" : "portrait";
      if (!pdf) {
        pdf = new jsPDF({ orientation, unit: "px", format: [img.width, img.height] });
      } else {
        pdf.addPage([img.width, img.height], orientation);
      }
      pdf.addImage(img, "JPEG", 0, 0, img.width, img.height);
    }
    return pdf ? pdf.output("blob") : null;
  }

  const fileBase = (data?.doc.title ?? "scan").replace(/[^\w\-]+/g, "-").slice(0, 60) || "scan";

  async function downloadPdf() {
    setBusy("Building your PDF…");
    try {
      const blob = await buildPdf();
      if (!blob) throw new Error("Nothing to export yet.");
      saveBlob(blob, `${fileBase}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf() {
    setBusy("Preparing to share…");
    try {
      const blob = await buildPdf();
      if (!blob) throw new Error("Nothing to share yet.");
      const file = new File([blob], `${fileBase}.pdf`, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: data?.doc.title ?? "Scan" });
      } else {
        saveBlob(blob, `${fileBase}.pdf`);
        toast.info("Sharing isn't available here, so the PDF was downloaded instead.");
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Could not share the PDF");
    } finally {
      setBusy(null);
    }
  }

  function downloadText() {
    const text = (data?.pages ?? [])
      .map((p, i) => `--- Page ${i + 1} ---\n${p.ocr_text ?? "(no text recognised)"}`)
      .join("\n\n");
    saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${fileBase}.txt`);
  }

  const hasText = (data?.pages ?? []).some((p) => p.ocr_text);

  return (
    <main className="min-h-screen bg-background px-4 pb-12 pt-4">
      <header className="mb-4 flex items-center gap-2">
        <Link to="/library">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> My scans
          </Button>
        </Link>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-destructive">We couldn't open this scan.</p>
      )}

      {data && (
        <>
          <div className="surface mb-4 p-4">
            <Input
              value={title ?? data.doc.title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const next = (title ?? "").trim();
                if (next && next !== data.doc.title) rename.mutate(next);
              }}
              aria-label="Scan name"
              className="text-base font-semibold"
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {data.pages.length} pages · {new Date(data.doc.created_at).toLocaleDateString()}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={downloadPdf}>
                <Download className="mr-2 h-4 w-4" /> PDF
              </Button>
              <Button size="sm" variant="secondary" onClick={sharePdf}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
              {hasText && (
                <Button size="sm" variant="secondary" onClick={downloadText}>
                  <FileText className="mr-2 h-4 w-4" /> Text
                </Button>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={deleteDoc}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            {data.pages.map((page, i) => (
              <div key={page.id} className="surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => setZoom(page.url)}
                  className="block w-full"
                  aria-label={`View page ${i + 1} larger`}
                >
                  <img src={page.url} alt={`Scanned page ${i + 1}`} loading="lazy" className="w-full bg-paper" />
                </button>
                <div className="flex items-center gap-2 p-3">
                  <span className="mr-auto text-sm text-muted-foreground">Page {i + 1}</span>
                  {page.ocr_text && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        await navigator.clipboard.writeText(page.ocr_text ?? "");
                        toast.success("Text copied");
                      }}
                    >
                      <Copy className="mr-2 h-4 w-4" /> Copy text
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deletePage(page)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {page.ocr_text && (
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-border p-3 text-sm text-muted-foreground">
                    {page.ocr_text}
                  </p>
                )}
              </div>
            ))}
          </div>

          {!data.pages.length && (
            <p className="py-12 text-center text-sm text-muted-foreground">This scan has no pages left.</p>
          )}
        </>
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-2"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="Scanned page" className="max-h-full w-auto max-w-full object-contain" />
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-4 top-4"
            onClick={() => setZoom(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {busy && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/85">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{busy}</p>
        </div>
      )}
    </main>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load a page image."));
    img.src = url;
  });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
