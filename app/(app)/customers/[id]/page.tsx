'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase/client';
import { formatCurrency, formatDate, getInitials } from '@/lib/format';
import { DocumentPreviewDialog, type PreviewableDocument } from '@/components/document-preview-dialog';
import {
  ArrowLeft, Phone, Mail, MapPin, User, FileText, Landmark,
  Wallet, Calendar, Loader2, Pencil, Plus,
} from 'lucide-react';
import Link from 'next/link';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [customer, setCustomer] = useState<any>(null);
  const [loans, setLoans] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [previewDoc, setPreviewDoc] = useState<PreviewableDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const id = params.id as string;
      const [c, l, p, d] = await Promise.all([
        supabase.from('customers').select('*, branches(name), areas(name), collectors(profiles(full_name))').eq('id', id).maybeSingle(),
        supabase.from('loans').select('*, loan_types(name)').eq('customer_id', id).order('created_at', { ascending: false }),
        supabase.from('payments').select('*, loans(loan_number)').eq('customer_id', id).order('payment_date', { ascending: false }),
        supabase.from('customer_documents').select('*').eq('customer_id', id).order('uploaded_at', { ascending: false }),
      ]);
      setCustomer(c.data);
      setLoans(l.data ?? []);
      setPayments(p.data ?? []);
      setDocuments(d.data ?? []);
      setLoading(false);
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return <p className="text-center text-muted-foreground py-16">Customer not found</p>;
  }

  const fullName = `${customer.first_name} ${customer.middle_name ?? ''} ${customer.last_name}`.trim();

  return (
    <div className="space-y-6">
      <PageHeader title={fullName} description="Customer profile and loan history">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Link href={`/loans?customer=${customer.id}`}>
          <Button size="sm">
            <Plus className="w-4 h-4 mr-2" />
            New Loan
          </Button>
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile card */}
        <Card className="glass-card border-border lg:col-span-1">
          <CardContent className="p-6 text-center">
            <Avatar className="w-24 h-24 mx-auto mb-4">
              <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                {getInitials(fullName)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-bold">{fullName}</h2>
            <Badge variant={customer.status === 'active' ? 'default' : 'secondary'} className="mt-2">
              {customer.status}
            </Badge>
            <div className="mt-6 space-y-3 text-left">
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{customer.phone ?? '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{customer.email ?? '—'}</span>
              </div>
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <span>
                  {customer.address ?? '—'}{customer.barangay ? `, Brgy. ${customer.barangay}` : ''}{customer.city ? `, ${customer.city}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <User className="w-4 h-4 text-muted-foreground" />
                <span>Gov ID: {customer.government_id ?? '—'}</span>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-border space-y-2 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Branch:</span>
                <span className="font-medium">{customer.branches?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Area:</span>
                <span className="font-medium">{customer.areas?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Collector:</span>
                <span className="font-medium">{customer.collectors?.profiles?.full_name ?? '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Max Loan:</span>
                <span className="font-medium">{formatCurrency(customer.max_loan_limit)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="loans">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="loans">Loan History</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>

            <TabsContent value="loans">
              <Card className="glass-card border-border">
                <CardHeader>
                  <CardTitle>Loan History</CardTitle>
                  <CardDescription>{loans.length} loans total</CardDescription>
                </CardHeader>
                <CardContent>
                  {loans.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No loans yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Loan #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Balance</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loans.map(l => (
                          <TableRow key={l.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => router.push(`/loans/${l.id}`)}>
                            <TableCell className="font-medium text-sm">{l.loan_number}</TableCell>
                            <TableCell className="text-sm">{formatCurrency(l.amount)}</TableCell>
                            <TableCell className="text-sm">{formatCurrency(l.remaining_balance)}</TableCell>
                            <TableCell className="text-sm">{formatDate(l.due_date)}</TableCell>
                            <TableCell>
                              <Badge variant={l.status === 'active' ? 'default' : l.status === 'overdue' ? 'destructive' : 'secondary'}>
                                {l.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payments">
              <Card className="glass-card border-border">
                <CardHeader>
                  <CardTitle>Payment History</CardTitle>
                  <CardDescription>{payments.length} payments total</CardDescription>
                </CardHeader>
                <CardContent>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No payments yet</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Loan #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Balance After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map(p => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm">{formatDate(p.payment_date)}</TableCell>
                            <TableCell className="text-sm">{p.loans?.loan_number ?? '—'}</TableCell>
                            <TableCell className="text-sm font-medium text-success">{formatCurrency(p.amount_paid)}</TableCell>
                            <TableCell className="text-sm">{formatCurrency(p.remaining_balance)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents">
              <Card className="glass-card border-border">
                <CardHeader>
                  <CardTitle>Documents</CardTitle>
                  <CardDescription>Uploaded files and attachments</CardDescription>
                </CardHeader>
                <CardContent>
                  {documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No documents uploaded</p>
                  ) : (
                    <div className="space-y-2">
                      {documents.map(d => (
                        <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{d.file_name ?? d.document_type}</p>
                            <p className="text-xs text-muted-foreground capitalize">{d.document_type.replace(/_/g, ' ')} • {formatDate(d.uploaded_at)}</p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setPreviewDoc(d)}>View</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DocumentPreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />
    </div>
  );
}
