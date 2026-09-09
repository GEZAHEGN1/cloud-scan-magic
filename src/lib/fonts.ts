/**
 * Unicode font loading for the rebuilt pages.
 *
 * The built-in PDF fonts only cover Latin-1, so any document written in
 * Amharic (or another non-Latin script) would come out blank. We embed a
 * Noto serif face that covers the script actually used in the text.
 */

type FaceSet = { key: string; regular: string; bold: string; css: string };

const ETHIOPIC = /[\u1200-\u137F]/;
const NON_LATIN1 = /[^\u0000-\u00FF]/;

const ETHIOPIC_FACES: FaceSet = {
  key: "NotoSerifEthiopic",
  regular: "/fonts/NotoSerifEthiopic-Regular.ttf",
  bold: "/fonts/NotoSerifEthiopic-Bold.ttf",
  css: "NotoSerifEthiopicApp",
};

const UNICODE_FACES: FaceSet = {
  key: "NotoSerif",
  regular: "/fonts/NotoSerif-Regular.ttf",
  bold: "/fonts/NotoSerif-Bold.ttf",
  css: "NotoSerifApp",
};

function facesFor(sample: string): FaceSet | null {
  if (ETHIOPIC.test(sample)) return ETHIOPIC_FACES;
  if (NON_LATIN1.test(sample)) return UNICODE_FACES;
  return null;
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load font ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const registered = new WeakSet<object>();

/**
 * Registers a Unicode face on the jsPDF document when the text needs one.
 * Returns the font family name to use with `pdf.setFont`.
 */
export async function ensurePdfFont(pdf: any, sample: string): Promise<string> {
  const faces = facesFor(sample);
  if (!faces) return "times";
  const marker = (pdf.__fonts ??= {}) as Record<string, boolean>;
  if (!marker[faces.key]) {
    const [reg, bold] = await Promise.all([fetchBase64(faces.regular), fetchBase64(faces.bold)]);
    pdf.addFileToVFS(`${faces.key}-Regular.ttf`, reg);
    pdf.addFont(`${faces.key}-Regular.ttf`, faces.key, "normal");
    pdf.addFileToVFS(`${faces.key}-Bold.ttf`, bold);
    pdf.addFont(`${faces.key}-Bold.ttf`, faces.key, "bold");
    marker[faces.key] = true;
    registered.add(pdf);
  }
  return faces.key;
}

const cssLoaded = new Set<string>();

/**
 * Loads the matching web font so the on-screen preview shows the real
 * glyphs. Returns a CSS font-family list.
 */
export async function ensureCanvasFont(sample: string): Promise<string> {
  const faces = facesFor(sample);
  if (!faces) return "Georgia, 'Times New Roman', serif";
  if (!cssLoaded.has(faces.key) && typeof FontFace !== "undefined") {
    const regular = new FontFace(faces.css, `url(${faces.regular})`, { weight: "400" });
    const bold = new FontFace(faces.css, `url(${faces.bold})`, { weight: "700" });
    await Promise.all([regular.load(), bold.load()]);
    document.fonts.add(regular);
    document.fonts.add(bold);
    cssLoaded.add(faces.key);
  }
  return `'${faces.css}', Georgia, serif`;
}
