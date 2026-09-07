/** Print-ready trim sizes used by KDP and Lulu, in inches. */
export type TrimSize = {
  id: string;
  label: string;
  provider: "KDP" | "Lulu" | "Standard";
  w: number;
  h: number;
};

export const TRIM_SIZES: TrimSize[] = [
  { id: "kdp-5x8", label: '5" × 8"', provider: "KDP", w: 5, h: 8 },
  { id: "kdp-5.25x8", label: '5.25" × 8"', provider: "KDP", w: 5.25, h: 8 },
  { id: "kdp-5.5x8.5", label: '5.5" × 8.5"', provider: "KDP", w: 5.5, h: 8.5 },
  { id: "kdp-6x9", label: '6" × 9"', provider: "KDP", w: 6, h: 9 },
  { id: "kdp-7x10", label: '7" × 10"', provider: "KDP", w: 7, h: 10 },
  { id: "kdp-8.5x11", label: '8.5" × 11"', provider: "KDP", w: 8.5, h: 11 },
  { id: "lulu-5.5x8.5", label: '5.5" × 8.5" (US Digest)', provider: "Lulu", w: 5.5, h: 8.5 },
  { id: "lulu-6.14x9.21", label: '6.14" × 9.21" (Royal)', provider: "Lulu", w: 6.14, h: 9.21 },
  { id: "lulu-6.69x9.61", label: '6.69" × 9.61" (Crown Quarto)', provider: "Lulu", w: 6.69, h: 9.61 },
  { id: "a4", label: 'A4 (8.27" × 11.69")', provider: "Standard", w: 8.27, h: 11.69 },
  { id: "a5", label: 'A5 (5.83" × 8.27")', provider: "Standard", w: 5.83, h: 8.27 },
];

export const PT = 72;

/** KDP inside-margin (gutter) table, by total page count. */
export function gutterInches(pageCount: number): number {
  if (pageCount <= 150) return 0.375;
  if (pageCount <= 300) return 0.5;
  if (pageCount <= 500) return 0.625;
  if (pageCount <= 700) return 0.75;
  return 0.875;
}

export type BookLayout = {
  trim: TrimSize;
  /** points */
  pageW: number;
  pageH: number;
  marginTop: number;
  marginBottom: number;
  marginOutside: number;
  marginInside: number;
  bodySize: number;
  leading: number;
  bleed: boolean;
  pageNumbers: boolean;
};

export function buildLayout(
  trim: TrimSize,
  opts: { pageCount: number; bodySize?: number; bleed?: boolean; pageNumbers?: boolean },
): BookLayout {
  const bleed = opts.bleed ?? false;
  const extra = bleed ? 0.125 : 0;
  const bodySize = opts.bodySize ?? Math.max(9.5, Math.min(12, trim.w * 1.9));
  return {
    trim,
    pageW: (trim.w + extra) * PT,
    pageH: (trim.h + extra * 2) * PT,
    marginTop: 0.75 * PT,
    marginBottom: 0.75 * PT,
    marginOutside: 0.5 * PT,
    marginInside: gutterInches(opts.pageCount) * PT,
    bodySize,
    leading: bodySize * 1.42,
    bleed,
    pageNumbers: opts.pageNumbers ?? true,
  };
}
