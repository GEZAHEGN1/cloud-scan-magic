# Rebuild pages from the photo, not from the text

## Why the layout keeps coming out wrong

Confirmed in the code: the rebuild step never sees your page. `ReconstructPanel` sends only the plain recognised text to the layout step (`analyzeLayout({ data: { text } })`), and that step is text-only. So bold words, centred titles, indents and spacing are being *guessed* from wording alone. That guess will never match your original, which is exactly what you are seeing.

## The fix

Let the rebuild step look at the actual photographed page while it reads it.

1. **One vision pass instead of two blind ones.** The page image is sent to the AI together with the request for structure, so it can see which words are bold, which lines are centred, where paragraphs indent, and where blank space separates sections.
2. **Richer description of each line.** Each piece of the page comes back with: what it is (title, paragraph, list item, contents entry, quote), its alignment, its relative size compared with the body text, whether it is bold, whether it starts an indented paragraph, and how much space sits above it.
3. **Faithful drawing.** The preview, the PDF and the Word file all draw from that same description, so what you see in "After" is what downloads — with your chosen finished size (6×9, KDP, Lulu, A4…) applied.
4. **Per page, in order.** Each scanned page is analysed as its own page, so page breaks land where the original had them instead of everything flowing into one stream.
5. **Fallback kept.** If the vision pass fails or credits run out, the current text-only rebuild still runs, with a clear message.

## What you will do

Open a scan, tap Rebuild. The After side should now mirror the original page: centred heading, bold words inside paragraphs, contents lines with dotted leaders and page numbers on the right, and the same paragraph rhythm — reset onto a clean page at your chosen book size.

## Technical notes

- New server function `analyzePageLayout` in `src/lib/scans.functions.ts`: takes `{ imageDataUrl, text? }`, calls the Lovable AI gateway vision model with the image plus a forced `emit_layout` tool call. Keeps the existing 429/402 error handling.
- Extend the block schema with `align`, `bold`, `level`, `sizeScale` (0.6–2.5), `indent` (boolean), `spaceBefore` (0–3, in line units), and keep `toc` + `page`.
- `Block` in `src/lib/reconstruct.ts` gains optional `sizeScale`, `indent`, `spaceBefore`; `styleFor` uses them instead of fixed per-type constants when present.
- `ReconstructPanel` takes the page image data URLs (already available in both the scanner review stage and the saved-document page via signed URLs) and calls the new function page by page, inserting a `pagebreak` between pages; falls back to `analyzeLayout` on failure.
- `renderBookPdf`, `renderPreview` and `renderBookDocx` read the new fields so preview/PDF/Word stay identical.
- Existing Unicode/Ethiopic font loading is unchanged.
