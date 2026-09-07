# Finish the scan viewer

The scanner, library, sign-in and text recognition are done. Two links already point to a document page that does not exist yet, so that page is the next piece.

## What gets built

**Document page (opened from a saved scan)**
- Shows every page of the scan in order, loaded securely so only the owner can see them.
- Tap a page to view it larger.
- Shows the recognised text under each page, with a copy button.
- Rename the scan title.
- Delete a single page, or delete the whole scan.
- Download as a multi-page PDF (one page image per PDF page, sized to the image).
- Download the recognised text as a plain text file.
- Share button that uses the phone's native share sheet for the PDF when available.

**Small fixes along the way**
- Back link to the library from the document page.
- Page title/description for search and link previews on the new page.

## Not in this step
OneDrive saving stays out until the Microsoft connection is approved. Once approved, a "Save to OneDrive" button gets added to this same document page.

## Technical notes
- New route `src/routes/_authenticated/doc.$docId.tsx` (the path both `library.tsx` and `scan.tsx` already link to).
- Data via the browser Supabase client under RLS: `documents` by id, `pages` ordered by `position`; images through signed URLs from the private `scans` bucket (1 hour expiry).
- PDF built client-side with the already-installed `jspdf`; images embedded as JPEG at their natural pixel size.
- Deleting a page removes both the storage object and the row; deleting a document removes its files, rows, and returns to the library.
- Reads use TanStack Query with cache invalidation after mutations.
