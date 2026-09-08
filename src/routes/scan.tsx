import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Download,
  Images,
  Loader2,
  RotateCw,
  ScanText,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { recognizeText } from "@/lib/scans.functions";
import {
  autoDetectQuad,
  canvasToBlob,
  dewarp,
  enhance,
  fileToCanvas,
  normalizeMids,
  rotateCanvas,
  type EnhanceMode,
  type Pt,
  type Quad,
} from "@/lib/imaging";
import { ReconstructPanel } from "@/components/ReconstructPanel";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "New scan — Flatlay" },
      { name: "description", content: "Capture a page, crop the edges, flatten the curve and save it." },
      { property: "og:title", content: "New scan — Flatlay" },
      { property: "og:description", content: "Capture a page, crop the edges, flatten the curve and save it." },
    ],
  }),
  component: ScanPage,
});

type ScannedPage = { id: string; canvas: HTMLCanvasElement; preview: string; text?: string };

const HANDLES = ["tl", "tm", "tr", "br", "bm", "bl"] as const;
type HandleKey = (typeof HANDLES)[number];

const FILTERS: { key: EnhanceMode; label: string }[] = [
  { key: "auto", label: "Clean" },
  { key: "gray", label: "Grayscale" },
  { key: "bw", label: "High contrast" },
  { key: "original", label: "Original" },
];

function ScanPage() {
  const [stage, setStage] = useState<"capture" | "crop" | "pages">("capture");
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [filter, setFilter] = useState<EnhanceMode>("auto");
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HandleKey | null>(null);
  const navigate = useNavigate();

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamError(null);
    } catch {
      setCamError("Camera unavailable. You can still pick a photo from your gallery.");
    }
  }, []);

  useEffect(() => {
    if (stage === "capture") void startCamera();
    else stopCamera();
    return stopCamera;
  }, [stage, startCamera, stopCamera]);

  function openCrop(canvas: HTMLCanvasElement) {
    setShot(canvas);
    setQuad(autoDetectQuad(canvas));
    setStage("crop");
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      toast.error("Camera is not ready yet.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    openCrop(canvas);
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    openCrop(await fileToCanvas(file));
  }

  function pointerPos(ev: React.PointerEvent): Pt | null {
    const box = cropBoxRef.current;
    if (!box || !shot) return null;
    const rect = box.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * shot.width,
      y: ((ev.clientY - rect.top) / rect.height) * shot.height,
    };
  }

  function onHandleMove(ev: React.PointerEvent) {
    const key = dragRef.current;
    if (!key || !quad || !shot) return;
    const p = pointerPos(ev);
    if (!p) return;
    const clamped = {
      x: Math.max(0, Math.min(shot.width, p.x)),
      y: Math.max(0, Math.min(shot.height, p.y)),
    };
    setQuad((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: clamped } as Quad;
      return key === "tm" || key === "bm" ? next : normalizeMids(next);
    });
  }

  async function acceptCrop() {
    if (!shot || !quad) return;
    setBusy("Flattening page…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const flat = enhance(dewarp(shot, quad), filter);
      setPages((p) => [
        ...p,
        { id: crypto.randomUUID(), canvas: flat, preview: flat.toDataURL("image/jpeg", 0.7) },
      ]);
      setShot(null);
      setQuad(null);
      setStage("pages");
    } catch {
      toast.error("Could not process that photo.");
    } finally {
      setBusy(null);
    }
  }

  function rotatePage(id: string) {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const rotated = rotateCanvas(p.canvas, 90);
        return { ...p, canvas: rotated, preview: rotated.toDataURL("image/jpeg", 0.7) };
      }),
    );
  }

  async function readText(id: string) {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    setBusy("Reading the text…");
    try {
      const small = document.createElement("canvas");
      const scale = Math.min(1, 1500 / page.canvas.width);
      small.width = Math.round(page.canvas.width * scale);
      small.height = Math.round(page.canvas.height * scale);
      small.getContext("2d")!.drawImage(page.canvas, 0, 0, small.width, small.height);
      const { text } = await recognizeText({
        data: { imageDataUrl: small.toDataURL("image/jpeg", 0.85) },
      });
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
      toast.success(text ? "Text captured" : "No text found on this page");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Text recognition failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (!pages.length) return;
    setBusy("Building your PDF…");
    try {
      const { jsPDF } = await import("jspdf");
      let pdf: import("jspdf").jsPDF | null = null;
      for (const page of pages) {
        const { width, height } = page.canvas;
        const orientation = width > height ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [width, height] });
        else pdf.addPage([width, height], orientation);
        pdf.addImage(page.canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, width, height);
      }
      const blob = pdf!.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scan.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast.error("Could not build the PDF");
    } finally {
      setBusy(null);
    }
  }

  async function saveAll() {
    if (!pages.length) return;
    setBusy("Saving your scan…");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        toast.info("Sign in to keep this scan in your library. Your pages stay here meanwhile.");
        navigate({ to: "/auth" });
        return;
      }

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({ user_id: uid, title: `Scan ${new Date().toLocaleString()}` })
        .select("id")
        .single();
      if (docErr) throw docErr;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (!page) continue;
        const blob = await canvasToBlob(page.canvas);
        const path = `${uid}/${doc.id}/${i}-${page.id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("scans")
          .upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { error: pageErr } = await supabase.from("pages").insert({
          document_id: doc.id,
          user_id: uid,
          position: i,
          storage_path: path,
          ocr_text: page.text ?? null,
        });
        if (pageErr) throw pageErr;
      }
      toast.success("Scan saved");
      navigate({ to: "/doc/$docId", params: { docId: doc.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the scan");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-28">
      <header className="flex items-center justify-between px-4 py-4">
        <Link to="/library">
          <Button variant="ghost" size="sm">
            My scans
          </Button>
        </Link>
        <span className="font-display text-sm font-bold tracking-tight">Flatlay</span>
        <span className="text-sm text-muted-foreground">{pages.length} pages</span>
      </header>

      {stage === "capture" && (
        <section className="px-4">
          <div className="surface relative overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[3/4] w-full bg-black object-cover"
            />
            <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-primary/70" />
            {camError && (
              <p className="absolute inset-x-4 bottom-4 rounded-lg bg-card/90 p-3 text-center text-sm text-muted-foreground">
                {camError}
              </p>
            )}
          </div>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Fill the frame with the page. Fingers outside the guide get cropped away.
          </p>
          <div className="mt-5 flex items-center justify-center gap-6">
            <label className="surface flex h-14 w-14 cursor-pointer items-center justify-center">
              <Images className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
            </label>
            <button
              onClick={capture}
              aria-label="Capture page"
              className="h-20 w-20 rounded-full border-4 border-primary bg-primary/20 transition-transform active:scale-95"
            />
            <button
              onClick={() => setStage("pages")}
              disabled={!pages.length}
              aria-label="Review pages"
              className="surface flex h-14 w-14 items-center justify-center disabled:opacity-40"
            >
              <Check className="h-5 w-5" />
            </button>
          </div>
        </section>
      )}

      {stage === "crop" && shot && quad && (
        <section className="px-4">
          <div
            ref={cropBoxRef}
            className="surface relative touch-none select-none overflow-hidden"
            onPointerMove={onHandleMove}
            onPointerUp={() => (dragRef.current = null)}
            onPointerLeave={() => (dragRef.current = null)}
          >
            <img src={shot.toDataURL("image/jpeg", 0.8)} alt="Captured page" className="w-full" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${shot.width} ${shot.height}`} preserveAspectRatio="none">
              <path
                d={`M ${quad.tl.x} ${quad.tl.y} Q ${2 * quad.tm.x - (quad.tl.x + quad.tr.x) / 2} ${2 * quad.tm.y - (quad.tl.y + quad.tr.y) / 2} ${quad.tr.x} ${quad.tr.y} L ${quad.br.x} ${quad.br.y} Q ${2 * quad.bm.x - (quad.bl.x + quad.br.x) / 2} ${2 * quad.bm.y - (quad.bl.y + quad.br.y) / 2} ${quad.bl.x} ${quad.bl.y} Z`}
                fill="oklch(0.74 0.17 52 / 0.12)"
                stroke="oklch(0.74 0.17 52)"
                strokeWidth={Math.max(2, shot.width / 300)}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {HANDLES.map((key) => (
              <span
                key={key}
                className="corner-handle"
                style={{
                  left: `${(quad[key].x / shot.width) * 100}%`,
                  top: `${(quad[key].y / shot.height) * 100}%`,
                }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  dragRef.current = key;
                }}
              />
            ))}
          </div>

          <p className="mt-3 text-center text-sm text-muted-foreground">
            Drag the corners to the page edges. Drag the top and bottom dots to follow the book curve.
          </p>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "secondary"}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="mt-5 flex gap-3">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => {
                setShot(null);
                setQuad(null);
                setStage("capture");
              }}
            >
              <X className="mr-2 h-4 w-4" /> Retake
            </Button>
            <Button size="lg" className="flex-1" onClick={acceptCrop}>
              <Zap className="mr-2 h-4 w-4" /> Flatten
            </Button>
          </div>
        </section>
      )}

      {stage === "pages" && (
        <section className="px-4">
          {pages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">No pages yet.</p>
          )}
          <div className="grid gap-4">
            {pages.map((page, i) => (
              <div key={page.id} className="surface overflow-hidden">
                <img src={page.preview} alt={`Page ${i + 1}`} className="w-full bg-paper" />
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <span className="mr-auto text-sm text-muted-foreground">Page {i + 1}</span>
                  <Button size="sm" variant="secondary" onClick={() => rotatePage(page.id)}>
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => readText(page.id)}>
                    <ScanText className="mr-2 h-4 w-4" />
                    {page.text ? "Re-read" : "Read text"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPages((prev) => prev.filter((p) => p.id !== page.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {page.text && (
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-border p-3 text-sm text-muted-foreground">
                    {page.text}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setStage("capture")}>
              <Camera className="mr-2 h-4 w-4" /> Add page
            </Button>
            <Button size="lg" className="flex-1" onClick={saveAll} disabled={!pages.length}>
              <Check className="mr-2 h-4 w-4" /> Save scan
            </Button>
          </div>

          {pages.length > 0 && (
            <>
              <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={downloadPdf}>
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
              <div className="mt-6">
                <ReconstructPanel
                  title="Scan"
                  fileBase="scan"
                  pageTexts={pages.map((p) => p.text ?? "")}
                  beforeUrl={pages[0]?.preview}
                />
              </div>
              <p className="mt-3 text-center text-sm text-muted-foreground">
                No account needed. Sign in only if you want your scans kept in a library.
              </p>
            </>
          )}
        </section>
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
