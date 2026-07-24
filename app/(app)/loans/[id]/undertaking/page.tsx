'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { COMPANY_NAME, COMPANY_NAME_DISPLAY, getDocumentBranding } from '@/lib/document-branding';
import { DocumentScaler } from '@/components/document-scaler';
import { ArrowLeft, FileText, Download, Loader2 } from 'lucide-react';

function formatLongDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Borrower's Undertaking clauses — fixed legal text, English + Tagalog.
const UNDERTAKING_CLAUSES = [
  {
    n: 1, title: 'Manner and Payment of Loans / Pagbabayad ng Loan',
    en: 'I understand that all my payments shall be recorded in the official records and payment ledger of the Company. I may request my amortization schedule, statement of account, or payment history from the field collector or branch manager.',
    tl: '(Nauunawaan ko na ang lahat ng aking mga bayad ay itatala sa opisyal na records ng kompanya at sa aking ledger o payment records. Maaari akong humiling ng amortization schedule, statement of account, o history of payments mula sa aking field collector o branch manager.)',
  },
  {
    n: 2, title: 'Official Payment Records / Mga Resibo at Katibayan ng Bayad',
    en: 'Every payment made by the Borrower shall be supported by an Acknowledgment Receipt, Official Receipt, or other proof of payment issued by the designated branch employee of the Lending Company.',
    tl: '(Ang bawat bayad na aking gagawin ay dapat may kaukulang Acknowledgment Receipt, Official Receipt, o iba pang katibayan ng pagbabayad na ibibigay ng awtorisadong kinatawan ng kompanya.)',
  },
  {
    n: 3, title: 'Disclosure of Loan Terms',
    en: 'I certify that prior to the release of the loan, the principal amount, interest rate, charges, penalties, payment schedule, and net loan proceeds were disclosed and explained to me in accordance with the Truth in Lending Act.',
    tl: '(Pinatutunayan ko na bago ang pagpapalabas ng loan ay ipinaliwanag sa akin ang principal amount, interest rate, charges, penalties, payment schedule, at net loan proceeds alinsunod sa Truth in Lending Act.)',
  },
  {
    n: 4, title: 'Collateral Loan',
    en: 'This loan is secured by personal property or appliances voluntarily offered by the Borrower as collateral, subject to a separate collateral agreement.',
    tl: '(Ang loan na ito ay may kaakibat na collateral na personal property o appliances na kusang inilahad ng borrower bilang collateral, alinsunod sa hiwalay na kasunduan o dokumento ng collateral.)',
  },
  {
    n: 5, title: 'Loan Renewal',
    en: 'Loan renewal is not automatic and shall remain subject to the evaluation and approval of the Company. Delinquent accounts or irregular payments may affect approval.',
    tl: '(Ang renewal ng loan ay hindi awtomatiko at nananatiling subject to evaluation at approval ng kompanya. Ang pagkakaroon ng past due account o hindi regular na paghuhulog ay maaaring maging dahilan ng hindi pag-apruba ng renewal.)',
  },
  {
    n: 6, title: 'Deliquency / Pagpalya sa Pagbayad',
    en: 'In the event of delayed or missed payments, I agree to cooperate with the Company for the proper settlement of my account. Any action involving collateral or collection shall be undertaken only in accordance with applicable laws and the corresponding agreements.',
    tl: '(Sa pagkakataong magkaroon ng pagkaantala o hindi pagbabayad ng obligasyon, sumasang-ayon akong makipagtulungan sa kompanya para sa maayos na pagresolba ng aking account. Anumang hakbang ukol sa collateral o collection ay isasagawa lamang alinsunod sa batas at sa mga kaukulang dokumento.)',
  },
  {
    n: 7, title: 'Third-Party Use / Paggamit ng Account ng ibang tao',
    en: "I understand that the loan account is my personal obligation and may not be transferred or assigned to another person without the Company's consent. I shall remain liable for all obligations arising from the loan application and documents I personally signed.",
    tl: '(Nauunawaan ko na ang loan account ay personal na obligasyon ko bilang borrower at hindi maaaring ilipat o ipagamit sa ibang tao nang walang pahintulot ng kompanya. Mananatili akong responsable sa lahat ng obligasyon na may kaugnayan sa loan na aking inapplyan at nilagdaan.)',
  },
  {
    n: 8, title: 'Penalty on Overdue Accounts / Penalty Charges',
    en: 'In the event of an overdue balance, the Company may impose a penalty charge of four percent (4%) per month on the overdue amount.',
    tl: '(Kung magkaroon ng overdue balance, sumasang-ayon ako na maaaring magpataw ang kompanya ng penalty charge na apat na porsiyento (4%) kada buwan sa overdue amount.)',
  },
  {
    n: 9, title: 'Installment Payments / Pagbabayad ng Hulog sa Loan',
    en: 'I understand my payment schedule and agree to make my payments on the prescribed dates to avoid penalties and lawful collection actions and that my daily payments imposed by me covers the whole amount payable for the Loan and shall be fully paid depending on outstanding balance and not the number of installment payments.',
    tl: '(Nauunawaan ko ang aking payment schedule at sumasang-ayon akong magbayad ng aking mga obligasyon sa itinakdang mga petsa upang maiwasan ang penalties at collection actions na pinahihintulutan ng batas at nauunawaan ko na ang arawang hulog ay para sa kabuuang Loan na dapat bayaran at hindi naka-depende sa bilang ng hulog.)',
  },
  {
    n: 10, title: 'Mode of Payment / Paraan ng Pagbabayad',
    en: "Payments shall only be made to authorized collectors, the Company's office, or other payment channels officially designated by 1125 Credit Collection Services.",
    tl: "(Ang mga bayad ay dapat gawin lamang sa mga awtorisadong collector, opisina ng kompanya, o iba pang payment channels na opisyal na pinahihintulutan ng 1125 Credit Collection Services.)",
  },
  {
    n: 11, title: 'Receipt of Loan Proceeds / Pagtanggap ng Loan',
    en: 'I certify that I personally received the net loan proceeds and that all applicable charges and obligations have been explained to me.',
    tl: '(Pinatutunayan ko na personal kong natanggap na halaga ng aking loan at naipaliwanag sa akin ang lahat ng kaukulang singil at obligasyon.)',
  },
  {
    n: 12, title: 'Voluntary Execution',
    en: 'I certify that I have read, understood, and voluntarily signed this Agreement without force, intimidation, or fraud.',
    tl: '(Pinatutunayan ko na aking nabasa, naunawaan, at kusang-loob na nilagdaan ang kasunduang ito nang walang pamimilit, pananakot, o panlilinlang.)',
  },
];

export default function UndertakingPage() {
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
      .select('*, customers(first_name, last_name, address, barangay, city, province), branches(name)')
      .eq('id', id)
      .maybeSingle();
    setLoan(data);
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!loan) {
    return <p className="text-center text-muted-foreground py-16">Loan not found</p>;
  }

  const addressParts = [loan.customers?.address, loan.customers?.barangay, loan.customers?.city, loan.customers?.province].filter(Boolean);
  const undertakingData = {
    date: loan.approved_at ?? new Date().toISOString(),
    borrowerName: `${loan.customers?.first_name ?? ''} ${loan.customers?.last_name ?? ''}`.trim(),
    residenceAddress: addressParts.join(', '),
  };
  const branding = getDocumentBranding(loan.branches?.name);

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
        toast({ title: 'Print blocked', description: 'Please allow pop-ups for this site to print the undertaking', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      printWindow.document.write(`
        <html>
          <head><title>Borrower's Undertaking ${loan.loan_number}</title></head>
          <body style="margin:0;padding:0;background:#fff;">
            ${dataUrls.map((url, i) => `<img src="${url}" style="width:100%;display:block;${i < dataUrls.length - 1 ? 'page-break-after:always;' : ''}" />`).join('')}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.onload = () => printWindow.print();
      printWindow.onafterprint = () => printWindow.close();
    } catch (err: any) {
      toast({ title: 'Print failed', description: err?.message ?? 'Could not generate undertaking for printing', variant: 'destructive' });
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
      pdf.save(`borrowers-undertaking-${loan.loan_number}.pdf`);
    } catch (err: any) {
      toast({ title: 'Download failed', description: err?.message ?? 'Could not generate undertaking PDF', variant: 'destructive' });
    }
    setDownloading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Borrower's Undertaking" description={`Kasunduan sa Pagkakautang bilang Borrower — ${loan.loan_number}`}>
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
          <div ref={page1Ref} style={{ width: 780, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif', fontSize: 13 }}>
            <div style={{ textAlign: 'center', borderBottom: '3px solid #0B7A3D', paddingBottom: 10, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#1F4E79' }}>{COMPANY_NAME}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>{branding.address.toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1F4E79' }}>CEL NO: {branding.contact}</div>
            </div>

            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15 }}>BORROWER'S UNDERTAKING</div>
            <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, marginBottom: 16 }}>(KASUNDUAN SA PAGKAKAUTANG BILANG BORROWER)</div>

            <p style={{ textAlign: 'justify', marginBottom: 12, textIndent: 48 }}>
              I <span style={{ textDecoration: 'underline' }}>{undertakingData.borrowerName}</span> of legal age, residing at{' '}
              <span style={{ textDecoration: 'underline' }}>{undertakingData.residenceAddress || '—'}</span> voluntarily agree to the following terms and conditions as a borrower of {COMPANY_NAME_DISPLAY}.
            </p>

            {UNDERTAKING_CLAUSES.slice(0, 6).map(c => (
              <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                <strong>{c.n}. {c.title}</strong> - {c.en} <em style={{ color: '#333' }}>{c.tl}</em>
              </p>
            ))}
          </div>

          <div ref={page2Ref} style={{ width: 780, background: '#fff', color: '#111', padding: 32, fontFamily: '"Times New Roman", Calibri, serif', fontSize: 13 }}>
            {UNDERTAKING_CLAUSES.slice(6).map(c => (
              <p key={c.n} style={{ textAlign: 'justify', fontSize: 12, marginBottom: 10 }}>
                <strong>{c.n}. {c.title}</strong> - {c.en} <em style={{ color: '#333' }}>{c.tl}</em>
              </p>
            ))}

            <p style={{ textAlign: 'justify', fontSize: 12, marginTop: 4, marginBottom: 20 }}>
              I hereby authorize {COMPANY_NAME_DISPLAY} to collect, process, verify, store, and use my personal information for purposes of loan evaluation, credit investigation, account administration, collection, and compliance with applicable laws and regulations. I understand that my information shall be protected in accordance with Republic Act No. 10173 or the Data Privacy Act of 2012.
            </p>

            <p style={{ fontSize: 13, marginBottom: 24 }}>
              IN WITNESS WHEREOF, I hereunto affix my signature this <span style={{ textDecoration: 'underline' }}>{formatLongDate(undertakingData.date)}</span>
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: 260, textAlign: 'center' }}>
                <div style={{ textDecoration: 'underline', marginBottom: 4 }}>{undertakingData.borrowerName}</div>
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
