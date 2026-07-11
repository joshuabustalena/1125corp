'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: { value: string; positive: boolean };
  variant?: 'default' | 'success' | 'warning' | 'danger';
  subtitle?: string;
}

const variantStyles = {
  default: 'bg-primary/5 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

export function StatCard({ title, value, icon, trend, variant = 'default', subtitle }: StatCardProps) {
  return (
    <Card className="glass-card border-border hover:shadow-lg transition-shadow duration-300 animate-slide-up">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', variantStyles[variant])}>
            {icon}
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            {trend.positive ? (
              <TrendingUp className="w-4 h-4 text-success" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive" />
            )}
            <span className={cn('text-xs font-medium', trend.positive ? 'text-success' : 'text-destructive')}>
              {trend.value}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
