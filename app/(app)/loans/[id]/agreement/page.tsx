'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/format';
import { COMPANY_NAME, getDocumentBranding } from '@/lib/document-branding';
import { DocumentScaler } from '@/components/document-scaler';
import { ArrowLeft, FileText, Download, Loader2 } from 'lucide-react';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// "24th day of June" style, used in the Loan Agreement's opening clause.
function formatOrdinalDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${ordinal(d.getDate())} day of ${month}`;
}

function formatLongDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Loan Agreement & Disclosure Statement clauses — the exact 8-clause wording
// provided. Clause 8 is followed by a trailing unnumbered closing paragraph
// (AGREEMENT_CLOSING_PARAGRAPH) rendered right after the numbered list.
const AGREEMENT_CLAUSES = [
  {
    n: 1, title: 'Disclosure of Loan Terms',
    en: 'The Borrower certifies that prior to the release of the loan proceeds, the Borrower was fully informed and provided with the following information: a. Principal loan amount; b. Interest rate and method of computation; c. Service fees, processing fees, and other charges, if any; d. Documentary Stamp Tax and other government charges, if applicable; e. Penalty charges and surcharges for late payment; f. Payment schedule and maturity date; g. Total amount payable during the loan term; h. Net loan proceeds actually receivable by the Borrower. The Borrower confirms that the foregoing disclosures comply with the requirements of Republic Act No. 3765, otherwise known as the Truth in Lending Act.',
  },
  {
    n: 2, title: 'Receipt of Loan Proceeds',
    en: 'The Borrower acknowledges having personally received the net loan proceeds stated in the Cash Voucher and other loan documents. The Borrower certifies that the amount received is complete, correct, and satisfactory. The Cash Voucher, Loan Agreement, Kasunduan, and related loan documents shall constitute sufficient proof of the release and receipt of the loan proceeds.',
  },
  {
    n: 3, title: 'Verification of Amount Received',
    en: 'The Borrower agrees to immediately verify the amount of cash received upon release thereof. Upon signing the Cash Voucher and related loan documents, the Borrower confirms that no shortage, deficiency, or discrepancy exists in the amount received.',
  },
  {
    n: 4, title: 'Waiver of False or Fraudulent Claims',
    en: 'The Borrower agrees not to make any false, fraudulent, or misleading claim against the Corporation concerning the release, receipt, or amount of the loan proceeds after the execution of the loan documents. Any claim of non-receipt, shortage, or deficiency made after the signing of the loan documents shall be presumed invalid unless supported by clear and convincing evidence of fraud, bad faith, or willful misconduct on the part of the Corporation or its authorized representatives.',
  },
  {
    n: 5, title: 'Authority of Collectors and Representatives',
    en: 'The Borrower acknowledges that only duly authorized employees, collectors, or representatives of the Corporation may release loan proceeds and receive payments on behalf of the Corporation. The Borrower agrees to transact only with authorized personnel and to request official receipts or payment records for every payment made with existing VALID COMPANY ID.',
  },
  {
    n: 6, title: "Borrower's Duty to Keep Records",
    en: 'The Borrower agrees to keep copies of the Loan Agreement, Cash Voucher, Kasunduan, Acknowledgement Receipts, and other loan documents for future reference.',
  },
  {
    n: 7, title: 'Voluntary Execution',
    en: 'The Borrower certifies that the Borrower has read and understood the contents of the loan documents, had the opportunity to ask questions regarding the loan transaction, and voluntarily signed the same without force, intimidation, or undue influence.',
  },
  {
    n: 8, title: 'Entire Agreement',
    en: 'The Borrower acknowledges that the Loan Agreement, Cash Voucher, Kasunduan, and related documents constitute the complete agreement between the parties concerning the loan transaction.',
  },
];

const AGREEMENT_CLOSING_PARAGRAPH = 'The Borrower affirms that all information and documents submitted to the Corporation are true and correct. Any material misrepresentation or falsification shall constitute a ground for acceleration of the loan and the exercise of all legal remedies available to the Corporation. I acknowledge that my signature herein constitutes my conformity to all the terms and conditions stated in the loan documents and serves as evidence of my receipt of the loan proceeds and disclosure of all applicable charges and obligations.';

export default function LoanAgreementPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [loan, setLoan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const id = params.id as string;
    const { data } = await supabase
      .from('loans')
      .select('*, customers(first_name, last_name, address, barangay, city, province, government_id), branches(name), collectors(profiles(full_name)), approved_by_profile:profiles!approved_by(full_name)')
      .eq('id', id)
      .maybeSingle();

    if (data?.renewed_from_loan_id) {
      const { data: prev } = await supabase.from('loans').select('remaining_balance').eq('id', data.renewed_from_loan_id).maybeSingle();
      (data as any).previousLoanRemainingBalance = prev?.remaining_balance ?? 0;
    }

    setLoan(data);
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Loan not found</p>;
  }

  // "Collection Charges (2%/month)" and the resulting "Total Amount Payable"
  // are computed here only for this document — they are NOT part of
  // loan.total_payable or any other calculation elsewhere in the app (which
  // only adds interest, not collection charges, to the principal).
  const isRenewal = !!loan.renewed_from_loan_id;
  const offsetBalance = Number(loan.offset_balance) || 0;
  // First Payment = the day-one collection, auto-settled out of the loan
  // proceeds at release. For a new loan that's the daily payment amount;
  // for a renewal it's the carried-over balance from the previous loan.
  const firstPayment = isRenewal
    ? Number(loan.previousLoanRemainingBalance ?? 0) - offsetBalance
    : (Number(loan.daily_payment) || 0);
  const serviceFee = Number(loan.service_fee) || 0;

  const termMonths = Math.round((loan.term_days / 30) * 10) / 10;
  const collectionChargeRate = 2;
  const collectionCharges = Math.round(Number(loan.amount) * (collectionChargeRate / 100) * termMonths * 100) / 100;
  const totalAmountPayable = Number(loan.amount) + Number(loan.interest_amount) + collectionCharges;
  const totalDeduction = firstPayment + serviceFee + offsetBalance;
  const loanProceeds = Number(loan.amount) - totalDeduction;

  const addressParts = [loan.customers?.address, loan.customers?.barangay, loan.customers?.city, loan.customers?.province].filter(Boolean);
  const fullAddress = addressParts.join(', ');
  const branding = getDocumentBranding(loan.branches?.name);
  const agreementData = {
    date: loan.approved_at ?? new Date().toISOString(),
    borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
    idNo: loan.customers?.government_id ?? '',
    residenceAddress: fullAddress,
    businessAddress: fullAddress,
    dueDate: loan.due_date,
    termMonths,
    amount: Number(loan.amount),
    interestRate: Number(loan.interest_rate),
    interestAmount: Number(loan.interest_amount),
    collectionChargeRate,
    collectionCharges,
    totalAmountPayable,
    firstPayment,
    serviceFee,
    offsetBalance,
    totalDeduction,
    loanProceeds,
    branchManagerName: loan.approved_by_profile?.full_name ?? '',
    branchName: loan.branches?.name ?? '',
    collectorName: loan.collectors?.profiles?.full_name ?? '',
  };

  const aRow = (label: React.ReactNode, value: React.ReactNode, bold = true) => (
    <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
      <span style={{ fontWeight: bold ? 700 : 400, minWidth: 190 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
  const dTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 };
  const dCell: React.CSSProperties = { padding: '3px 6px' };

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
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the agreement', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Loan Agreement ${loan.loan_number}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate agreement for printing', variant: 'destructive' });
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
      pdf.save(`loan-agreement-${loan.loan_number}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate agreement PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Loan Agreement & Disclosure Statement" description={`Generated for ${loan.loan_number}`}>
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
        <div className="flex flex-col items-center gap-4">
          <div ref={page1Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif', fontSize: 13 }}>
            <div style={{ textAlign: 'center', borderBottom: '3px solid #0B7A3D', paddingBottom: 10, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#1F4E79' }}>{COMPANY_NAME}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>{branding.address.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>CEL NO: {branding.contact}</div>
            </div>

            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
              LOAN AGREEMENT &amp; DISCLOSURE STATEMENT
            </div>

            <p style={{ textAlign: 'justify', marginBottom: 10 }}>
              This Loan Agreement executed on the {formatOrdinalDate(agreementData.date)} by {COMPANY_NAME} located at{' '}
              <span style={{ textDecoration: 'underline' }}>{branding.address}</span> hereinafter referred to as the <strong>LENDER</strong>;
            </p>
            <p style={{ textAlign: 'center', fontWeight: 700, marginBottom: 10 }}>- AND -</p>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              {aRow('Name of BORROWER', <span style={{ textDecoration: 'underline' }}>{agreementData.borrowerName}</span>)}
              <span style={{ display: 'flex', gap: 8 }}><strong>ID NO:</strong> <span>{agreementData.idNo || '—'}</span></span>
            </div>
            {aRow('Residence Address:', agreementData.residenceAddress || '—')}
            {aRow('Business Address:', agreementData.businessAddress || '—')}

            <p style={{ fontWeight: 700, marginTop: 12, marginBottom: 2 }}>Loan Details:</p>
            {aRow('Date of Loan:', formatLongDate(agreementData.date))}
            {aRow(<>Loan Due Date: <em>({agreementData.termMonths}-month term)</em></>, formatLongDate(agreementData.dueDate))}

            <table style={dTable}>
              <tbody>
                <tr><td style={{ ...dCell, fontWeight: 700 }}>Amount of Loan</td><td style={dCell} /><td style={{ ...dCell, textAlign: 'right' }} /><td style={{ ...dCell, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(agreementData.amount)}</td></tr>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700 }}>Interest</td>
                  <td style={{ ...dCell, fontStyle: 'italic' }}>(with an interest rate of {agreementData.interestRate}% /month)</td>
                  <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.interestAmount)}</td>
                  <td style={dCell} />
                </tr>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700 }}>Collection Charges</td>
                  <td style={{ ...dCell, fontStyle: 'italic' }}>({agreementData.collectionChargeRate}% per month)</td>
                  <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.collectionCharges)}</td>
                  <td style={dCell} />
                </tr>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700, borderTop: '1px solid #000' }}>Total Amount Payable</td>
                  <td style={{ ...dCell, borderTop: '1px solid #000' }} />
                  <td style={{ ...dCell, textAlign: 'right', borderTop: '1px solid #000' }}>{formatCurrency(agreementData.totalAmountPayable)}</td>
                  <td style={{ ...dCell, borderTop: '1px solid #000' }} />
                </tr>
                <tr>
                  <td style={dCell} />
                  <td style={{ ...dCell, fontWeight: 700 }}>Less: First Payment</td>
                  <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.firstPayment)}</td>
                  <td style={dCell} />
                </tr>
                <tr>
                  <td style={dCell} />
                  <td style={{ ...dCell, fontWeight: 700, fontStyle: 'italic' }}>Service Fee (inclusive of DST)</td>
                  <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.serviceFee)}</td>
                  <td style={dCell} />
                </tr>
                <tr>
                  <td style={dCell} />
                  <td style={{ ...dCell, fontWeight: 700 }}>Offset Balance from previous loan</td>
                  <td style={{ ...dCell, textAlign: 'right' }}>{formatCurrency(agreementData.offsetBalance)}</td>
                  <td style={dCell} />
                </tr>
                <tr>
                  <td style={dCell} />
                  <td style={{ ...dCell, fontWeight: 700, borderTop: '1px solid #000' }}>Total Deduction</td>
                  <td style={dCell} />
                  <td style={{ ...dCell, textAlign: 'right', borderTop: '1px solid #000', fontWeight: 700 }}>{formatCurrency(agreementData.totalDeduction)}</td>
                </tr>
                <tr>
                  <td style={{ ...dCell, fontWeight: 700, borderTop: '2px solid #000' }}>Loan Proceeds:</td>
                  <td style={{ ...dCell, borderTop: '2px solid #000' }} />
                  <td style={{ ...dCell, borderTop: '2px solid #000' }} />
                  <td style={{ ...dCell, textAlign: 'right', borderTop: '2px solid #000', fontWeight: 700 }}>{formatCurrency(agreementData.loanProceeds)}</td>
                </tr>
              </tbody>
            </table>

            <p style={{ fontWeight: 700, marginTop: 16, marginBottom: 6 }}>The Borrower hereby represents, warrants, acknowledges, and agrees as follows:</p>

            {AGREEMENT_CLAUSES.slice(0, 4).map(c => (
              <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                <strong>{c.n}. {c.title}</strong> - {c.en}
              </p>
            ))}
          </div>

          <div ref={page2Ref} style={{ width: 780, minHeight: 1010, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif', fontSize: 13 }}>
            {AGREEMENT_CLAUSES.slice(4).map(c => (
              <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                <strong>{c.n}. {c.title}</strong> - {c.en}
              </p>
            ))}

            <p style={{ textAlign: 'justify', fontSize: 12, marginTop: 4, marginBottom: 40 }}>
              {AGREEMENT_CLOSING_PARAGRAPH}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.branchManagerName || ' '}</div>
                <div style={{ fontStyle: 'italic' }}>Branch Manager{agreementData.branchName ? ` - ${agreementData.branchName} Branch` : ''}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.collectorName || ' '}</div>
                <div style={{ fontStyle: 'italic' }}>Assigned Collector</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{agreementData.borrowerName || ' '}</div>
                <div style={{ fontStyle: 'italic' }}>Borrower</div>
              </div>
            </div>
          </div>
        </div>
        </DocumentScaler>
        </div>
      </div>
    </div>
  );
}
