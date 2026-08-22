// Shared "open a popup and window.print() a rendered document image" HTML
// builder, used by every printed document (Loan Agreement, Undertaking,
// Voucher, Gas Voucher, Cash Voucher, Collection List, Payslip).
//
// Earlier attempts got this wrong twice:
//   1. A plain width:100% <img> with no height cap let tall content overflow
//      the physical page and spill onto a mostly-blank second page.
//   2. Forcing every page into a fixed-size box with `object-fit: contain`
//      (or `max-height` + `overflow: hidden`) stopped the overflow, but
//      `overflow: hidden` doesn't reliably stop print PAGINATION in Chrome —
//      the print engine still page-breaks based on the unclipped content
//      height, so tall content could still spill to a second page. Content
//      shorter than the box, meanwhile, got vertically centered and left
//      thick blank bars top and bottom.
//
// The fix computed here is arithmetic, not CSS trickery: work out the
// image's natural height at full page width, and only shrink it (by
// reducing its rendered width — never by cropping) if that natural height
// would exceed the physical page. That guarantees the page height passed to
// @page is never exceeded, so nothing can ever page-break, while unshrunk
// content still renders at its true full size instead of being padded out
// to fill a fixed box.
export function buildPrintHtml(
  title: string,
  pages: { url: string; width: number; height: number }[],
  pageWidthIn: number,
  maxPageHeightIn: number,
): string {
  const topMarginIn = 0.2;
  const availableHeightIn = maxPageHeightIn - topMarginIn;

  const pageHtml = pages.map((p) => {
    const naturalHeightIn = pageWidthIn * (p.height / p.width);
    const renderHeightIn = Math.min(naturalHeightIn, availableHeightIn);
    const scale = renderHeightIn / naturalHeightIn; // <= 1, only shrinks if it must
    const pageBoxHeightIn = renderHeightIn + topMarginIn;
    return `<div class="doc-page" style="height:${pageBoxHeightIn}in"><img src="${p.url}" style="width:${scale * 100}%" /></div>`;
  }).join('');

  return `
    <html>
      <head><title>${title}</title><style>
        @page { size: ${pageWidthIn}in ${maxPageHeightIn}in; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .doc-page { width: ${pageWidthIn}in; box-sizing: border-box; padding-top: ${topMarginIn}in; margin: 0 auto; overflow: hidden; page-break-after: always; }
        .doc-page:last-child { page-break-after: auto; }
        .doc-page img { display: block; margin: 0 auto; }
      </style></head>
      <body>${pageHtml}</body>
    </html>
  `;
}
