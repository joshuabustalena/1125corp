'use client';

import { forwardRef } from 'react';
import { COMPANY_NAME_DISPLAY } from '@/lib/document-branding';
import { formatCurrency } from '@/lib/format';
import {
  statementLines, monthLabel,
  type IncentiveInputs, type IncentiveResult, type IncentiveType, type StatementLine,
} from '@/lib/incentives';

export interface IncentiveDocumentProps {
  type: IncentiveType;
  month: string;
  employeeName: string;
  position: string;
  branchLabel: string;
  areaLabel: string | null;
  inputs: IncentiveInputs;
  result: IncentiveResult;
}

const LINE_STYLE: Record<NonNullable<StatementLine['tone']>, React.CSSProperties> = {
  bold: { fontWeight: 700 },
  muted: { color: '#9CA3AF' },
  accent: { fontWeight: 700, color: '#2563EB' },
  net: { fontWeight: 700, color: '#DC2626' },
};

// The statement itself, laid out like Kat's Excel. Colors are fixed rather than
// themed because it's what gets captured to PDF and printed.
export const IncentiveDocument = forwardRef<HTMLDivElement, IncentiveDocumentProps>(function IncentiveDocument(
  { type, month, employeeName, position, branchLabel, areaLabel, inputs, result },
  ref,
) {
  const cell: React.CSSProperties = { padding: '6px 10px', border: '1px solid #D1D5DB', fontSize: 13 };
  return (
    <div ref={ref} style={{ background: '#fff', color: '#111', padding: 24, width: '100%', maxWidth: 480, margin: '0 auto', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '3px solid #0B1F3A', paddingBottom: 10, marginBottom: 12 }}>
        <img src="/image/1125_Corp_Logo.png" alt="1125Corp" style={{ width: 40, height: 40, objectFit: 'contain' }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0B1F3A' }}>{COMPANY_NAME_DISPLAY}</div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {type === 'collector' ? 'Statement of Area Performance and Incentive'
              : type === 'branch_manager' ? 'Statement of Branch Performance and Incentive'
                : 'Incentive Statement'}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#444', marginBottom: 10, lineHeight: 1.6 }}>
        <div>{position}</div>
        <div>{branchLabel}{areaLabel ? ` · ${areaLabel}` : ''}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'left', background: '#F3F4F6', fontSize: 14 }}>{employeeName.toUpperCase()}</th>
            <th style={{ ...cell, textAlign: 'right', background: '#F3F4F6', fontSize: 14, whiteSpace: 'nowrap' }}>{monthLabel(month)}</th>
          </tr>
        </thead>
        <tbody>
          {statementLines(type, inputs, result).map(line => {
            const style = line.tone ? LINE_STYLE[line.tone] : undefined;
            return (
              <tr key={line.label}>
                <td style={{ ...cell, ...style }}>{line.label}</td>
                <td style={{ ...cell, ...style, textAlign: 'right' }}>
                  {line.value === 0 && line.emptyText
                    ? line.emptyText
                    : line.kind === 'percent' ? `${line.value.toFixed(2)}%` : formatCurrency(line.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!result.eligible && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, fontSize: 12, color: '#991B1B' }}>
          <strong>Not eligible for an incentive this month:</strong> {result.ineligibleReasons.join('; ')}.
        </div>
      )}
    </div>
  );
});
