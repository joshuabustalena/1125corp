import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '1125Corp — Enterprise Loan Management System',
  description: '1125Corp — Professional loan management, collections, payroll, and accounting platform for lending corporations.',
  icons: {
    icon: '/image/1125_Corp_Logo.png',
  },
  openGraph: {
    title: '1125Corp',
    description: 'Enterprise Loan Management System',
    siteName: '1125corp.org',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
