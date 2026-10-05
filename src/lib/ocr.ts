/**
 * Free, on-device text recognition (OCR) using Tesseract.js.
 * Runs entirely in the browser — no AI credits, no server, no limits.
 * Supports English and Amharic out of the box.
 */

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(["eng", "amh"]);
    })();
  }
  return workerPromise;
}

/** Reads the text out of a page image (canvas or data URL). */
export async function recognizePageText(image: HTMLCanvasElement | string): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return data.text.trim();
}
