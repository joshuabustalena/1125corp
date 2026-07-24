'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, ShieldCheck, Loader2, AlertCircle, Mail, Lock, ArrowRight, Sparkles, FileCheck2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [user, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) {
      setError(error);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="h-[100dvh] relative overflow-hidden">
      {/* Full-bleed background image */}
      <Image
        src="/image/coverbackground.png"
        alt=""
        fill
        priority
        className="object-cover"
      />
      {/* Gradient overlay for legibility + brand tint */}
      <div className="absolute inset-0 bg-gradient-to-br from-[rgb(11,31,58)]/90 via-[rgb(11,31,58)]/70 to-black/80" />
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-blue-400 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[28rem] h-[28rem] bg-primary rounded-full blur-3xl" />
      </div>

      {/* Scrolls internally as a last resort on very short screens, without
          dragging the fixed background along with it. */}
      <div className="relative z-10 h-full overflow-y-auto flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[90rem] grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20 items-center px-2 sm:px-6 my-auto">
        {/* Left - branding */}
        <div className="hidden lg:flex flex-col gap-10 text-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
              <Image src="/image/1125_Corp_Logo.png" alt="1125Corp" width={64} height={64} className="object-contain" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">1125Corp</h1>
              <p className="text-base text-white/60">1125corp.org</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wide text-white/80 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5 text-blue-300" />
              ENTERPRISE-GRADE PLATFORM
            </div>
            <h2 className="text-6xl font-bold leading-[1.1] tracking-tight">
              Enterprise Loan<br />
              <span className="bg-gradient-to-r from-blue-300 via-sky-200 to-white bg-clip-text text-transparent">
                Management System
              </span>
            </h2>
            <p className="text-xl text-white/70 max-w-xl">
              Professional lending platform with collections, payroll, accounting,
              and real-time analytics for modern lending corporations.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-xl">
            {[
              'Customer Management',
              'Loan Processing',
              'Payment Collection',
              'Payroll & HR',
              'Accounting',
              'Audit & Reports',
            ].map((feature, i) => (
              <div
                key={feature}
                className="flex items-center gap-2.5 text-base text-white/85 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'backwards' }}
              >
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                {feature}
              </div>
            ))}
          </div>

          <p className="text-base text-white/40">
            © 2026 1125Corp. All rights reserved.
          </p>
        </div>

        {/* Right - form */}
        <div className="w-full max-w-lg mx-auto lg:mx-0 lg:ml-auto animate-slide-up">
          <div className="relative rounded-3xl p-8 sm:p-10 lg:p-11 border border-white/10 bg-[rgb(11,31,58)]/70 backdrop-blur-2xl shadow-2xl shadow-black/50 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-blue-500" />

            <div className="lg:hidden flex items-center gap-3 mb-6 justify-center text-white">
              <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                <Image src="/image/1125_Corp_Logo.png" alt="1125Corp" width={56} height={56} className="object-contain" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">1125Corp</h1>
                <p className="text-sm text-white/60">1125corp.org</p>
              </div>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Welcome back</h2>
            <p className="text-white/60 text-sm sm:text-base mb-4 sm:mb-8">
              Sign in to access your dashboard
            </p>

            {error && (
              <div className="mb-5 flex items-center gap-2 p-3.5 rounded-lg bg-destructive/20 border border-destructive/30 text-white text-sm animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
              <div className="space-y-2.5">
                <Label htmlFor="email" className="text-white/80 text-base">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@1125corp.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11 sm:h-[3.25rem] text-base pl-12 pr-4 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/40 transition-colors focus-visible:bg-white/[0.14]"
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-white/80 text-base">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-white/70 hover:text-white hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-11 sm:h-[3.25rem] text-base pl-12 pr-11 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-white/40 transition-colors focus-visible:bg-white/[0.14]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked === true)}
                  className="border-white/30 data-[state=checked]:bg-white data-[state=checked]:text-primary"
                />
                <Label htmlFor="remember" className="text-base text-white/60 cursor-pointer">
                  Remember me for 30 days
                </Label>
              </div>

              <Button
                type="submit"
                className="group w-full h-11 sm:h-[3.25rem] text-base sm:text-lg bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-950/40 transition-all hover:shadow-xl hover:shadow-blue-900/40 hover:-translate-y-0.5"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-4 sm:mt-8 pt-4 sm:pt-6 border-t border-white/10 flex items-center justify-center gap-3 sm:gap-6">
              <div className="flex items-center gap-1.5 text-xs text-white/50">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
                Encrypted connection
              </div>
              <div className="flex items-center gap-1.5 text-xs text-white/50">
                <FileCheck2 className="w-3.5 h-3.5 text-emerald-400/80" />
                Audit-ready records
              </div>
            </div>
          </div>

          <p className="text-center text-sm sm:text-base text-white/60 mt-4 sm:mt-8">
            Need an account? Contact your system administrator.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
