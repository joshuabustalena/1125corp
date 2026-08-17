'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/format';
import { COMPANY_NAME, COMPANY_NAME_DISPLAY, getDocumentBranding } from '@/lib/document-branding';
import { DocumentScaler } from '@/components/document-scaler';
import { ArrowLeft, Banknote, Download, Loader2 } from 'lucide-react';

function formatVoucherDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export default function VoucherPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [loan, setLoan] = useState<any>(null);
  const [voucherNumber, setVoucherNumber] = useState('—');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const id = params.id as string;
    const [{ data }, { data: voucher }] = await Promise.all([
      supabase
        .from('loans')
        .select('*, customers(first_name, last_name), collectors(profiles(full_name)), branches(name), approved_by_profile:profiles!approved_by(full_name), disbursed_by_profile:profiles!disbursed_by(full_name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('cash_vouchers').select('voucher_number').eq('loan_id', id).maybeSingle(),
    ]);

    setLoan(data);
    setVoucherNumber(voucher?.voucher_number ?? '—');
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Loan not found</p>;
  }

  const isRenewal = !!loan.renewed_from_loan_id;
  // offset_balance was captured directly from the old loan's remaining
  // balance at the moment renewal was applied for — it's the only reliable
  // record of what that balance actually was, since the old loan's own
  // remaining_balance is intentionally zeroed once this renewal is
  // disbursed (so it stops double-counting as still-outstanding). "Actual
  // balance" and "Beginning Balance" both refer to that same captured
  // figure; First Payment is a separate, independent deduction (the loan's
  // own daily payment amount) — same two-separate-deductions model the
  // Loan Agreement document uses.
  const actualBalance = Number(loan.offset_balance) || 0;
  const beginningBalance = Number(loan.offset_balance) || 0;
  const firstPayment = isRenewal
    ? (loan.daily_payment != null && Number(loan.daily_payment) > 0
      ? Number(loan.daily_payment)
      : (loan.term_days > 0 ? Number(loan.total_payable) / loan.term_days : 0))
    : 0;

  const voucherData = {
    voucherNumber,
    date: loan.disbursed_at ?? new Date().toISOString(),
    isRenewal,
    borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
    netProceeds: Number(loan.release_amount),
    fieldCollectorName: loan.collectors?.profiles?.full_name ?? '',
    branchCashierName: loan.disbursed_by_profile?.full_name ?? '',
    branchManagerName: loan.approved_by_profile?.full_name ?? '',
    branchName: loan.branches?.name ?? '',
    actualBalance,
    firstPayment,
    beginningBalance,
  };
  const branding = getDocumentBranding(loan.branches?.name);

  const vTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
  const vCell: React.CSSProperties = { border: '1px solid #000', padding: '6px 10px', verticalAlign: 'middle' };
  const vCellCenter: React.CSSProperties = { ...vCell, textAlign: 'center' };
  const vHeader: React.CSSProperties = { ...vCellCenter, fontWeight: 700 };
  const vItalic: React.CSSProperties = { ...vCellCenter, fontStyle: 'italic' };
  // No text glyph at all (neither "✓" nor "X" rasterized correctly through
  // the html2canvas + print/PDF pipeline — both came out blank, misaligned,
  // or oversized on the actual printed page despite looking fine live). A
  // solid inset square is pure box-model/background-color, so it renders
  // identically everywhere: on screen, in the html2canvas capture, and on
  // the printed page.
  const vCheckbox = (checked: boolean) => (
    <span style={{ display: 'inline-block', width: 20, height: 20, border: '2.5px solid #000', marginRight: 6, verticalAlign: 'middle', position: 'relative' }}>
      {checked && (
        <span style={{ position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, background: '#000' }} />
      )}
    </span>
  );
  const pageStyle: React.CSSProperties = { width: 780, background: '#fff', color: '#111', padding: 36, fontFamily: '"Times New Roman", Calibri, serif' };

  async function handlePrint() {
    const refs = [page1Ref, page2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setPrinting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const dataUrls: string[] = [];
      for (const ref of refs) {
        const canvas = await html2canvas(ref.current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        dataUrls.push(canvas.toDataURL('image/png'));
      }
      const printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow) {
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the voucher', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Voucher ${voucherData.voucherNumber}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate voucher for printing', variant: 'destructive' });
    }
    setPrinting(false);
  }

  async function handleDownload() {
    const refs = [page1Ref, page2Ref].filter(r => r.current);
    if (refs.length === 0) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      // 8.5" x 13" (Philippine "folio"/long bond paper), in points (72pt/in).
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [612, 936] });
      const margin = 24;
      const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      const pxToPt = 0.75;

      for (let i = 0; i < refs.length; i++) {
        const canvas = await html2canvas(refs[i].current as HTMLDivElement, { backgroundColor: '#ffffff', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = usableWidth;
        const imgHeight = ((canvas.height / 2) * pxToPt / ((canvas.width / 2) * pxToPt)) * imgWidth;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
      }
      pdf.save(`voucher-${voucherData.voucherNumber}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate voucher PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Loan Disbursement Documents — ${voucherData.voucherNumber}`} description="2 pages: Loan Release Cash Voucher, and Cash Voucher + Acknowledgement Receipt of Loan combined">
        <Button variant="outline" size="sm" onClick={() => router.push(`/loans/${loan.id}`)}>
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={printing}>
          {printing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Print
        </Button>
        <Button size="sm" onClick={handleDownload} disabled={downloading}>
          {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}Download PDF
        </Button>
      </PageHeader>

      <div className="max-w-[1000px] mx-auto">
        <div className="bg-secondary/30 p-4 rounded-lg">
        <DocumentScaler width={780}>
        <div className="space-y-6 flex flex-col items-center">
          {/* PAGE 1 — Loan Release Cash Voucher */}
          <div ref={page1Ref} style={pageStyle}>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#0B1F3A' }}>{COMPANY_NAME}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>{branding.address.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>CEL NO: {branding.contact}</div>
            </div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 18, color: '#0B1F3A', marginBottom: 14, textDecoration: 'underline' }}>
              LOAN RELEASE CASH VOUCHER
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, marginBottom: 8 }}>Voucher No. <strong>{voucherData.voucherNumber}</strong></div>
            <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 13 }}>
              <span>{vCheckbox(voucherData.isRenewal)}Renewal</span>
              <span>{vCheckbox(!voucherData.isRenewal)}New Loan Account</span>
            </div>
            <table style={vTable}>
              <tbody>
                <tr><td style={vCell}>Date:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                <tr><td style={vHeader}>Name of Borrower</td><td style={vHeader}>Net Loan Proceeds</td></tr>
                <tr><td style={vCellCenter}>{voucherData.borrowerName}</td><td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td></tr>
                <tr><td style={vCell}>Disbursed by:</td><td style={vCell}>Received by:</td></tr>
                <tr style={{ height: 42 }}><td style={vCell}>&nbsp;</td><td style={vCell}>&nbsp;</td></tr>
                <tr><td style={vCellCenter}>{voucherData.fieldCollectorName}</td><td style={vCellCenter}>{voucherData.borrowerName}</td></tr>
                <tr><td style={vItalic}>Field Collector</td><td style={vItalic}>Borrower</td></tr>
              </tbody>
            </table>

            <p style={{ fontWeight: 700, fontSize: 12, marginTop: 20, textAlign: 'justify', textIndent: 40, lineHeight: 1.35 }}>
              I further certify that this Cash Voucher constitutes sufficient proof and evidence of my receipt of the net loan proceeds. I hereby waive any claim, demand, complaint, or action against {COMPANY_NAME_DISPLAY} for any alleged cash shortage, deficiency, or non-receipt of the loan proceeds after the execution and signing of this document.
            </p>
            <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333', lineHeight: 1.35, marginTop: 6 }}>
              (Pinatutunayan ko na ang Cash Voucher na ito ay sapat na katibayan at patunay na aking natanggap ang nitong halaga ng aking loan. Nauunawaan ko na hindi maari ang anumang paghahabol, reklamo, demanda, o anumang aksyon laban sa {COMPANY_NAME_DISPLAY} kaugnay ng anumang kakulangan sa salapi, diperensya, o hindi pagtanggap ng loan proceeds matapos kong lagdaan at maisakatuparan ang dokumentong ito)
            </p>

            <p style={{ fontWeight: 700, fontSize: 12, marginTop: 16, textAlign: 'justify', textIndent: 40, lineHeight: 1.35 }}>
              The amount of my loan shall be reflected in the Field Collector's Customer List together with the corresponding beginning balance. Attached hereto are copies of the Loan Agreement and Kasunduan, which shall serve as proof of the proper and lawful release of the loan proceeds by the duly authorized collectors of {COMPANY_NAME_DISPLAY}.
            </p>
            <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333', lineHeight: 1.35, marginTop: 6 }}>
              (Ang halaga ng aking loan ay makikita sa Customer List ng Field Collector kasama ang kaukulang panimulang balanse. Nakalakip dito ang mga kopya ng Loan Agreement at Kasunduan na magsisilbing patunay ng maayos, tama, at naaayon sa batas na pagpapalabas ng loan proceeds ng mga awtorisadong kolektor ng {COMPANY_NAME_DISPLAY}.)
            </p>

            {voucherData.isRenewal && (
              <table style={{ ...vTable, marginTop: 12 }}>
                <tbody>
                  <tr><td colSpan={2} style={vHeader}>Amount of Loan</td></tr>
                  <tr>
                    <td style={{ ...vCell, fontStyle: 'italic' }}>Actual balance from the date of loan</td>
                    <td style={{ ...vCell, fontStyle: 'italic', textAlign: 'right' }}>{formatCurrency(voucherData.actualBalance)}</td>
                  </tr>
                  <tr>
                    <td style={vCell}>Less: First Payment</td>
                    <td style={{ ...vCell, textAlign: 'right' }}>{formatCurrency(voucherData.firstPayment)}</td>
                  </tr>
                  <tr>
                    <td style={{ ...vCell, fontWeight: 700 }}>Beginning Balance</td>
                    <td style={{ ...vCell, fontWeight: 700, textAlign: 'right' }}>{formatCurrency(voucherData.beginningBalance)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            <p style={{ color: '#C00000', fontWeight: 700, fontSize: 12, marginTop: 18 }}>
              Paalala sa mga customers ng 1125 Credit Collection Services:
            </p>
            <p style={{ fontSize: 11, textAlign: 'justify', textIndent: 40, lineHeight: 1.35, marginTop: 6 }}>
              Mangyaring itago ang Cash Voucher na ito at lahat ng kaugnay na dokumento ng inyong loan bilang inyong opisyal na rekord. Ugaliing humingi at suriin ang inyong resibo at kasaysayan ng pagbabayad mula sa inyong nakatalagang kolektor. Ang inyong lagda sa dokumentong ito ay nagpapatunay na natanggap ninyo ang netong halaga ng inyong loan proceeds.
            </p>
            <p style={{ fontSize: 11, textAlign: 'justify', textIndent: 40, lineHeight: 1.35, marginTop: 8 }}>
              Mahalagang humingi ng resibo sa bawat bayad na ginagawa para sa iyong loan upang maiwasan ang anumang hindi pagkakaintindihan sa balance. Maaari ka ring mag-request ng payment history mula sa iyong assigned collector kung nais mong mas malinawan ang status ng iyong loan. Basahin ng maigi ang bawat pinipirmahang dokumento na katibayang ikaw ay may loan sa 1125 Credit Collection Services.
            </p>
          </div>

          {/* PAGE 2 — Cash Voucher (Branch Cashier -> Field Collector) +
              Acknowledgement Receipt of Loan, combined onto one page since
              the Cash Voucher block alone is short enough to share a sheet. */}
          <div ref={page2Ref} style={pageStyle}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#0B1F3A' }}>{COMPANY_NAME}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>{branding.address.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>CEL NO: {branding.contact}</div>
            </div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#0B1F3A', marginBottom: 12, textDecoration: 'underline' }}>
              LOAN RELEASE CASH VOUCHER
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, marginBottom: 6 }}>Voucher No. <strong>{voucherData.voucherNumber}</strong></div>
            <table style={vTable}>
              <tbody>
                <tr><td style={vCell}>Date:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                <tr><td style={vHeader}>Name of Borrower</td><td style={vHeader}>Net Proceeds</td></tr>
                <tr><td style={vCellCenter}>{voucherData.borrowerName}</td><td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td></tr>
                <tr><td style={vCell}>Disbursed by:</td><td style={vCell}>Received by:</td></tr>
                <tr style={{ height: 40 }}><td style={vCell}>&nbsp;</td><td style={vCell}>&nbsp;</td></tr>
                <tr><td style={vCellCenter}>{voucherData.branchCashierName}</td><td style={vCellCenter}>{voucherData.fieldCollectorName}</td></tr>
                <tr><td style={vItalic}>Branch Cashier</td><td style={vItalic}>Field Collector</td></tr>
              </tbody>
            </table>

            <div style={{ textAlign: 'center', marginTop: 32 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#0B1F3A' }}>{COMPANY_NAME}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>{branding.address.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#0B1F3A' }}>CEL NO: {branding.contact}</div>
            </div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#0B1F3A', marginTop: 8 }}>ACKNOWLEDGEMENT RECEIPT OF LOAN</div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#0B1F3A', marginBottom: 16 }}>(via Field Release)</div>
            <table style={vTable}>
              <tbody>
                <tr><td style={vCell}>Date of Receipt:</td><td style={vCell}>{formatVoucherDate(voucherData.date)}</td></tr>
                <tr><td style={vCell}>Assigned Field Collector:</td><td style={vCell}>{voucherData.fieldCollectorName}</td></tr>
              </tbody>
            </table>

            <table style={{ ...vTable, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={vHeader}>Amount of Loan Proceeds Delivered</th>
                  <th style={vHeader}>Borrower's Name</th>
                  <th style={vHeader}>Signature</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={vCellCenter}>{formatCurrency(voucherData.netProceeds)}</td>
                  <td style={vCellCenter}>{voucherData.borrowerName}</td>
                  <td style={{ ...vCell, height: 40 }}>&nbsp;</td>
                </tr>
              </tbody>
            </table>

            <table style={{ ...vTable, marginTop: 8 }}>
              <tbody>
                <tr><td style={vCell}>Delivered by:</td><td style={vCell}>Verified by:</td><td style={vCell}>Prepared by</td></tr>
                <tr>
                  <td style={vCellCenter}>{voucherData.fieldCollectorName}</td>
                  <td style={vCellCenter}>{voucherData.branchManagerName}</td>
                  <td style={vCellCenter}>{voucherData.branchCashierName}</td>
                </tr>
                <tr><td style={vItalic}>Assigned Field Collector</td><td style={vItalic}>Branch Manager</td><td style={vItalic}>Branch Cashier</td></tr>
              </tbody>
            </table>

            <p style={{ fontWeight: 700, fontSize: 12, marginTop: 16, textAlign: 'justify', textIndent: 40, lineHeight: 1.3 }}>
              I further certify that this Cash Voucher constitutes sufficient proof and evidence of my receipt of the net loan proceeds. I hereby waive any claim, demand, complaint, or action against {COMPANY_NAME_DISPLAY} for any alleged cash shortage, deficiency, or non-receipt of the loan proceeds after the execution and signing of this document.
            </p>
            <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333', lineHeight: 1.3 }}>
              (Pinatutunayan ko na ang Cash Voucher na ito ay sapat na katibayan at patunay na aking natanggap ang nitong halaga ng aking loan. Nauunawaan ko na hindi maari ang anumang paghahabol, reklamo, demanda, o anumang aksyon laban sa {COMPANY_NAME_DISPLAY} kaugnay ng anumang kakulangan sa salapi, diperensya, o hindi pagtanggap ng loan proceeds matapos kong lagdaan at maisakatuparan ang dokumentong ito)
            </p>

            <p style={{ fontWeight: 700, fontSize: 12, textAlign: 'justify', textIndent: 40, lineHeight: 1.3 }}>
              The amount of my loan shall be reflected in the Field Collector's Customer List together with the corresponding beginning balance. Attached hereto are copies of the Loan Agreement and Kasunduan, which shall serve as proof of the proper and lawful release of the loan proceeds by the duly authorized collectors of {COMPANY_NAME_DISPLAY}.
            </p>
            <p style={{ fontStyle: 'italic', fontSize: 11, textAlign: 'justify', color: '#333', lineHeight: 1.3 }}>
              (Ang halaga ng aking loan ay makikita sa Customer List ng Field Collector kasama ang kaukulang panimulang balanse. Nakalakip dito ang mga kopya ng Loan Agreement at Kasunduan na magsisilbing patunay ng maayos, tama, at naaayon sa batas na pagpapalabas ng loan proceeds ng mga awtorisadong kolektor ng {COMPANY_NAME_DISPLAY}.)
            </p>
          </div>
        </div>
        </DocumentScaler>
        </div>
      </div>
    </div>
  );
}
