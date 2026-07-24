import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { Toaster } from '@/components/ui/toaster';
import { PwaRegister } from '@/components/pwa-register';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '1125Corp',
  description: '1125Corp — Professional loan management, collections, payroll, and accounting platform for lending corporations.',
  manifest: '/manifest.webmanifest',
  themeColor: '#0b1f3a',
  viewport: 'width=device-width, initial-scale=1',
  icons: {
    icon: '/image/1125_Corp_Logo.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '1125Corp',
  },
  other: {
    'mobile-web-app-capable': 'yes',
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
            <PwaRegister />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
