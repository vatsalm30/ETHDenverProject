// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useInvoiceFinance } from '../stores/invoiceFinanceStore';
import type { TrustScoreData, BankTrustScoreData, BuyerTrustScoreData } from '../stores/invoiceFinanceStore';
import { useProfile } from '../stores/profileStore';
import { useUserStore } from '../stores/userStore';
import { useToast } from '../stores/toastStore';
import type {
    InvoiceDto,
    FinancingAuctionDto,
    CreateInvoiceRequest,
    StartAuctionRequest,
    UpdateProfileRequest,
    CloseAuctionResult,
} from '../openapi.d.ts';

// ─── Design tokens ───────────────────────────────────────────────────────────

const C = {
    bg:       'var(--bg)',
    surface:  'var(--surface)',
    surface2: 'var(--surface2)',
    surface3: 'var(--surface3)',
    border:   'var(--border)',
    border2:  'var(--border2)',
    text1:    'var(--text-1)',
    text2:    'var(--text-2)',
    text3:    'var(--text-3)',
    red:      'var(--red)',
    redBg:    'var(--red-bg)',
    teal:     'var(--teal)',
    tealBg:   'var(--teal-bg)',
    amber:    'var(--amber)',
    amberBg:  'var(--amber-bg)',
    green:    'var(--green)',

    // legacy aliases used in logic
    primary:  'var(--red)',
    dark:     'var(--red)',
    gold:     'var(--amber)',
    text:     'var(--text-1)',
    muted:    'var(--text-2)',
    glass:    'var(--surface)',
    shadow:   'none',
    gradient: 'var(--red)',
    instGrad: 'var(--amber)',
};

// Font family constants
const F = {
    heading: "'Barlow Condensed', sans-serif",
    mono:    "'Share Tech Mono', monospace",
    body:    "'Barlow', sans-serif",
};

// ─── Shared primitives ──────────────────────────────────────────────────────

function fmt$(n: number | undefined | null) {
    if (n == null) return '—';
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function daysUntil(dateStr: string | null | undefined): number {
    if (!dateStr) return 0;
    return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }> = ({ children, style, onClick }) => (
    <div
        onClick={onClick}
        style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            padding: '12px 14px',
            marginBottom: 2,
            ...style,
        }}
    >
        {children}
    </div>
);

const GlassCard = Card;

const Btn: React.FC<{
    onClick?: () => void;
    color?: string;
    variant?: 'solid' | 'outline' | 'ghost';
    small?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
    type?: 'button' | 'submit';
}> = ({ onClick, color = C.red, variant = 'solid', small, disabled, children, style, type = 'button' }) => (
    <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        style={{
            padding: small ? '5px 12px' : '8px 16px',
            fontSize: small ? 11 : 12,
            fontFamily: F.heading,
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '1.5px',
            border: variant === 'outline' ? `1px solid ${C.border2}` : 'none',
            background: disabled ? C.surface3 : variant === 'solid' ? color : 'transparent',
            color: disabled ? C.text3 : variant === 'solid' ? '#fff' : C.text2,
            cursor: disabled ? 'default' : 'pointer',
            transition: 'background-color 0.1s',
            ...style,
        }}
    >
        {children}
    </button>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color = C.red }) => (
    <div style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        padding: '10px 14px',
        textAlign: 'center',
        flex: 1,
    }}>
        <div style={{ fontFamily: F.mono, fontSize: 22, fontWeight: 900, color }}>{value}</div>
        <div style={{ fontFamily: F.heading, fontSize: '0.59rem', color: C.text3, marginTop: 2, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>{label}</div>
    </div>
);

const Tab: React.FC<{ label: string; active: boolean; count?: number; onClick: () => void; accent: string }> = ({
    label, active, count, onClick,
}) => (
    <button
        onClick={onClick}
        style={{
            padding: '8px 16px',
            fontFamily: F.heading,
            fontWeight: active ? 700 : 600,
            fontSize: 13,
            textTransform: 'uppercase' as const,
            letterSpacing: '1px',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            position: 'relative',
            color: active ? C.text1 : C.text3,
            borderBottom: active ? `2px solid ${C.red}` : '2px solid transparent',
            marginBottom: -1,
        }}
    >
        {label}
        {count != null && count > 0 && (
            <span style={{
                marginLeft: 6,
                background: active ? C.red : C.surface3,
                color: active ? '#fff' : C.text3,
                padding: '1px 6px',
                fontFamily: F.mono,
                fontSize: 10,
            }}>
                {count}
            </span>
        )}
    </button>
);

const EmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => (
    <div style={{ textAlign: 'center', padding: '32px 0', color: C.text3 }}>
        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>{icon}</div>
        <div style={{ fontFamily: F.body, fontSize: 13 }}>{message}</div>
    </div>
);

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, { bg: string; fg: string; border: string }> = {
        CONFIRMED:            { bg: C.tealBg,  fg: C.teal,  border: 'rgba(0,180,166,0.25)' },
        PENDING_CONFIRMATION: { bg: C.amberBg, fg: C.amber, border: 'rgba(210,153,34,0.25)' },
        IN_AUCTION:           { bg: C.amberBg, fg: C.amber, border: 'rgba(210,153,34,0.25)' },
        FINANCED:             { bg: 'rgba(63,185,80,0.10)', fg: C.green, border: 'rgba(63,185,80,0.25)' },
        PAID:                 { bg: 'rgba(63,185,80,0.10)', fg: C.green, border: 'rgba(63,185,80,0.25)' },
        OPEN:                 { bg: C.tealBg,  fg: C.teal,  border: 'rgba(0,180,166,0.25)' },
        CLOSED:               { bg: C.surface3, fg: C.text3, border: C.border },
    };
    const c = map[status] || { bg: C.surface3, fg: C.text3, border: C.border };
    return (
        <span style={{
            background: c.bg,
            color: c.fg,
            border: `1px solid ${c.border}`,
            padding: '2px 7px',
            fontFamily: F.heading,
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '1px',
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

const EvmSettlementBadge: React.FC<{ bridgeState?: string | null; txHash?: string | null }> = ({ bridgeState, txHash }) => {
    if (!bridgeState) return null;
    const cfg: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
        PENDING:    { label: 'Settlement Pending', bg: C.amberBg,  fg: C.amber, dot: '#d29922' },
        CONFIRMING: { label: 'Confirming on EVM',  bg: C.tealBg,   fg: C.teal,  dot: '#00b4a6' },
        CONFIRMED:  { label: 'EVM Confirmed',      bg: 'rgba(63,185,80,0.10)', fg: C.green, dot: '#3fb950' },
    };
    const c = cfg[bridgeState] ?? { label: bridgeState, bg: C.surface3, fg: C.text3, dot: '#6b7280' };
    return (
        <div style={{ background: c.bg, border: `1px solid ${c.fg}25`, padding: '6px 10px', marginTop: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: txHash ? 4 : 0 }}>
                <motion.div
                    animate={bridgeState !== 'CONFIRMED' ? { opacity: [1, 0.3, 1] } : {}}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }}
                />
                <span style={{ fontFamily: F.heading, fontWeight: 700, color: c.fg, textTransform: 'uppercase' as const, letterSpacing: '1px', fontSize: 11 }}>EVM: {c.label}</span>
            </div>
            {txHash && (
                <div style={{ fontFamily: F.mono, fontSize: 11, color: c.fg, opacity: 0.8 }}>
                    TX {txHash.substring(0, 12)}…
                </div>
            )}
        </div>
    );
};

// ─── AI Invoice Upload ──────────────────────────────────────────────────────

interface ParsedFields { invoiceId?: string; amount?: string; description?: string; issueDate?: string; dueDate?: string; }

const AIInvoiceUpload: React.FC<{ onParsed: (f: ParsedFields) => void }> = ({ onParsed }) => {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'parsed' | 'error'>('idle');
    const [fileName, setFileName] = useState('');
    const toast = useToast();

    const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        setLoading(true); setStatus('idle');
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            const fileBase64 = btoa(binary);
            const mimeType = file.type || 'image/jpeg';
            const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY ?? '';
            if (!apiKey) {
                const today = new Date().toISOString().split('T')[0];
                const due = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
                onParsed({ invoiceId: 'INV-' + Date.now().toString().slice(-6), amount: '', description: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), issueDate: today, dueDate: due });
                setStatus('parsed');
                toast.displaySuccess('Fields pre-filled. Add VITE_ANTHROPIC_API_KEY for full AI parsing.');
                return;
            }
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }, { type: 'text', text: 'Extract invoice data. Return ONLY JSON: {"invoiceNumber":"","amount":null,"issueDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","description":""}' }] }] }),
            });
            if (!resp.ok) throw new Error(`API error: ${resp.status}`);
            const data = await resp.json();
            let text: string = data?.content?.[0]?.text ?? '';
            text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(text);
            const toDate = (v: unknown) => { if (!v) return ''; const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0]; };
            onParsed({ invoiceId: parsed.invoiceNumber ?? '', amount: parsed.amount != null ? String(parsed.amount) : '', description: parsed.description ?? '', issueDate: toDate(parsed.issueDate), dueDate: toDate(parsed.dueDate) });
            setStatus('parsed');
        } catch { setStatus('error'); toast.displayError('Could not parse invoice — fill in manually.'); }
        finally { setLoading(false); e.target.value = ''; }
    }, [onParsed, toast]);

    return (
        <div style={{ border: `1px dashed ${C.border2}`, padding: 12, background: C.surface2, textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: F.heading, fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>AI INVOICE PARSER</div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: C.text3, marginBottom: 6 }}>Upload an invoice image or PDF to auto-fill fields</div>
            <label style={{ cursor: loading ? 'wait' : 'pointer' }}>
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
                <span style={{
                    display: 'inline-block', padding: '6px 16px',
                    background: loading ? C.surface3 : C.teal,
                    color: loading ? C.text3 : '#fff',
                    fontFamily: F.heading, fontSize: 11, fontWeight: 700,
                    textTransform: 'uppercase' as const, letterSpacing: '1.5px',
                    cursor: 'pointer',
                }}>
                    {loading ? 'PARSING…' : 'UPLOAD INVOICE'}
                </span>
            </label>
            {status === 'parsed' && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.green, marginTop: 6 }}>{fileName} — fields populated</div>}
            {status === 'error' && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.red, marginTop: 6 }}>Parse failed — fill manually</div>}
        </div>
    );
};

// ─── Profile Setup Modal ────────────────────────────────────────────────────

const ProfileSetupModal: React.FC<{ onSave: (r: UpdateProfileRequest) => Promise<void> }> = ({ onSave }) => {
    const SECTORS = ['Agriculture', 'Construction', 'Education', 'Energy', 'Finance', 'Healthcare', 'Hospitality', 'Legal', 'Logistics', 'Manufacturing', 'Media', 'Real Estate', 'Retail', 'Technology', 'Telecommunications', 'Transportation', 'Other'];
    const stored = (localStorage.getItem('user-role') ?? localStorage.getItem('cupid-role')) as 'COMPANY' | 'INSTITUTION' | null;
    const [form, setForm] = useState<UpdateProfileRequest>({ displayName: '', type: stored ?? 'COMPANY', sector: 'Technology' });
    const [saving, setSaving] = useState(false);
    const set = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [key]: e.target.value }));
    const setNum = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }));
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '8px 12px',
        border: `1px solid ${C.border2}`,
        fontSize: 13, outline: 'none', boxSizing: 'border-box',
        background: C.surface2, color: C.text1,
        fontFamily: F.mono,
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 24, maxWidth: 480, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ marginBottom: 20 }}>
                    <h2 style={{ margin: '0 0 4px', fontFamily: F.heading, fontWeight: 700, fontSize: 18, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>SET UP PROFILE</h2>
                    <p style={{ margin: 0, color: C.text3, fontFamily: F.body, fontSize: 13 }}>Tell us about your organization to get started</p>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                            style={{
                                flex: 1, padding: '8px 0',
                                fontFamily: F.heading, fontWeight: 700, fontSize: 12,
                                textTransform: 'uppercase' as const, letterSpacing: '1.5px',
                                cursor: 'pointer',
                                border: `1px solid ${form.type === t ? C.red : C.border}`,
                                background: form.type === t ? C.redBg : 'transparent',
                                color: form.type === t ? C.red : C.text3,
                            }}
                        >
                            {t}
                        </button>
                    ))}
                </div>
                <form onSubmit={async (e) => { e.preventDefault(); if (!form.displayName?.trim()) return; setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>{form.type === 'COMPANY' ? 'Company' : 'Institution'} Name *</label>
                            <input value={form.displayName} onChange={set('displayName')} placeholder={form.type === 'COMPANY' ? 'Acme Corp' : 'First Capital Bank'} required style={inputStyle} />
                        </div>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Sector</label>
                            <select value={form.sector ?? ''} onChange={set('sector')} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {SECTORS.map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Founded Year</label>
                            <input type="number" placeholder="2010" value={form.foundedYear ?? ''} onChange={setNum('foundedYear')} style={inputStyle} />
                        </div>
                        {form.type === 'COMPANY' && <>
                            <div>
                                <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Annual Revenue ($)</label>
                                <input type="number" placeholder="5000000" value={form.annualRevenue ?? ''} onChange={setNum('annualRevenue')} style={inputStyle} />
                            </div>
                            <div>
                                <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Employees</label>
                                <input type="number" placeholder="50" value={form.employeeCount ?? ''} onChange={setNum('employeeCount')} style={inputStyle} />
                            </div>
                        </>}
                    </div>
                    <button type="submit" disabled={saving || !form.displayName?.trim()}
                        style={{
                            width: '100%', marginTop: 16, padding: '10px 0',
                            background: saving || !form.displayName?.trim() ? C.surface3 : C.red,
                            color: saving || !form.displayName?.trim() ? C.text3 : '#fff',
                            border: 'none',
                            fontFamily: F.heading, fontWeight: 700, fontSize: 13,
                            textTransform: 'uppercase' as const, letterSpacing: '1.5px',
                            cursor: saving ? 'wait' : 'pointer',
                        }}
                    >
                        {saving ? 'SAVING…' : 'GET STARTED'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// ─── Invoice Create Modal ───────────────────────────────────────────────────

const InvoiceCreateModal: React.FC<{ onClose: () => void; onCreate: (r: CreateInvoiceRequest) => Promise<void> }> = ({ onClose, onCreate }) => {
    const { trustScore, fetchBuyerScore } = useInvoiceFinance();
    const [buyerScore, setBuyerScore] = useState<BuyerTrustScoreData | null>(null);
    const [buyerLookupLoading, setBuyerLookupLoading] = useState(false);
    const lookupBuyer = async (partyId: string) => {
        if (!partyId.trim()) return;
        setBuyerLookupLoading(true);
        try { setBuyerScore(await fetchBuyerScore(partyId)); }
        finally { setBuyerLookupLoading(false); }
    };
    const today = new Date().toISOString().split('T')[0];
    const defaultDue = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
    const [form, setForm] = useState({ invoiceId: 'INV-' + Date.now().toString().slice(-6), buyerParty: 'buyer-party', amount: '', description: '', paymentTermDays: '90', issueDate: today, dueDate: defaultDue });
    const [saving, setSaving] = useState(false);
    const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '8px 12px',
        border: `1px solid ${C.border2}`,
        fontSize: 13, outline: 'none', boxSizing: 'border-box',
        background: C.surface2, color: C.text1,
        fontFamily: F.mono,
    };

    const isProvisional = trustScore?.tier === 'PROVISIONAL';
    const cap = trustScore?.invoiceValueCap ?? 5000;
    const amountNum = parseFloat(form.amount) || 0;
    const overCap = isProvisional && amountNum > cap;

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 20, maxWidth: 480, width: '90%', maxHeight: '92vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontFamily: F.heading, fontWeight: 700, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '1px', fontSize: 16 }}>NEW INVOICE</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: C.text3 }}>✕</button>
                </div>

                {isProvisional && (
                    <div style={{ background: C.amberBg, border: `1px solid rgba(210,153,34,0.25)`, padding: '10px 14px', marginBottom: 12 }}>
                        <div style={{ fontFamily: F.heading, fontWeight: 700, color: C.amber, fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 4 }}>
                            PROVISIONAL TIER — CAP: {fmt$(cap)}
                        </div>
                        <div style={{ fontFamily: F.body, fontSize: 12, color: C.text2 }}>
                            Complete more invoices to unlock higher limits.
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                            <span style={{ background: 'rgba(63,185,80,0.10)', color: C.green, border: '1px solid rgba(63,185,80,0.25)', padding: '2px 7px', fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>P1 PASS</span>
                            <span style={{ background: C.amberBg, color: C.amber, border: '1px solid rgba(210,153,34,0.25)', padding: '2px 7px', fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>P2 PENDING</span>
                            <span style={{ background: C.amberBg, color: C.amber, border: '1px solid rgba(210,153,34,0.25)', padding: '2px 7px', fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>P3 PENDING</span>
                            <span style={{ background: C.amberBg, color: C.amber, border: '1px solid rgba(210,153,34,0.25)', padding: '2px 7px', fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>P4 PENDING</span>
                        </div>
                    </div>
                )}

                <AIInvoiceUpload onParsed={f => setForm(p => ({ ...p, ...(f.invoiceId ? { invoiceId: f.invoiceId } : {}), ...(f.amount ? { amount: f.amount } : {}), ...(f.description ? { description: f.description } : {}), ...(f.issueDate ? { issueDate: f.issueDate } : {}), ...(f.dueDate ? { dueDate: f.dueDate } : {}) }))} />
                <form onSubmit={async e => { e.preventDefault(); if (overCap) return; setSaving(true); try { await onCreate({ invoiceId: form.invoiceId, buyerParty: form.buyerParty, amount: parseFloat(form.amount), description: form.description, paymentTermDays: parseInt(form.paymentTermDays), issueDate: form.issueDate, dueDate: form.dueDate }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div><label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Invoice ID *</label><input style={inputStyle} value={form.invoiceId} onChange={set('invoiceId')} required /></div>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Amount ($) *</label>
                            <input style={{ ...inputStyle, borderColor: overCap ? C.red : C.border2 }} type="number" min="1" value={form.amount} onChange={set('amount')} placeholder="100000" required />
                            {overCap && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.red, marginTop: 2, fontWeight: 700 }}>Exceeds {fmt$(cap)} provisional cap</div>}
                        </div>
                        <div style={{ gridColumn: '1/-1' }}><label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Description *</label><input style={inputStyle} value={form.description} onChange={set('description')} placeholder="10,000 steel bolts" required /></div>
                        <div><label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Issue Date *</label><input style={inputStyle} type="date" value={form.issueDate} onChange={set('issueDate')} required /></div>
                        <div><label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Due Date *</label><input style={inputStyle} type="date" value={form.dueDate} onChange={set('dueDate')} required /></div>
                        <div><label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Payment Terms (days)</label><input style={inputStyle} type="number" value={form.paymentTermDays} onChange={set('paymentTermDays')} /></div>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Buyer Party ID</label>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <input style={{ ...inputStyle, flex: 1 }} value={form.buyerParty} onChange={e => { set('buyerParty')(e); setBuyerScore(null); }} />
                                <Btn small color={C.amber} variant="outline" onClick={() => lookupBuyer(form.buyerParty)} disabled={buyerLookupLoading || !form.buyerParty.trim()}>
                                    {buyerLookupLoading ? '…' : 'LOOKUP'}
                                </Btn>
                            </div>
                        </div>
                    </div>
                    {buyerScore && (() => {
                        const bTierCfg = TIER_CFG[buyerScore.tier] ?? TIER_CFG.PROVISIONAL;
                        const isHighRisk = buyerScore.tier === 'UNRATED';
                        return (
                            <div style={{ background: isHighRisk ? C.redBg : bTierCfg.bg, border: `1px solid ${isHighRisk ? 'rgba(232,0,45,0.25)' : bTierCfg.border}`, padding: '10px 12px', marginTop: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontFamily: F.heading, fontWeight: 700, fontSize: 12, color: isHighRisk ? C.red : bTierCfg.color, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                                        BUYER: {buyerScore.tier}
                                        {buyerScore.certified && !isHighRisk && <span style={{ marginLeft: 6, fontSize: 11 }}>CERTIFIED</span>}
                                    </span>
                                    <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: isHighRisk ? C.red : bTierCfg.color }}>
                                        {buyerScore.totalScore}/{buyerScore.maxPossibleScore}
                                    </span>
                                </div>
                                {isHighRisk && <div style={{ fontFamily: F.body, fontSize: 11, color: C.red, fontWeight: 600, marginBottom: 4 }}>UNRATED buyer — banks will see HIGH RISK.</div>}
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {[
                                        { label: 'P1', status: buyerScore.proof1_status },
                                        { label: 'P2', status: buyerScore.proof2_status },
                                        { label: 'P3', status: buyerScore.proof3_status },
                                        { label: 'P4', status: buyerScore.proof4_status },
                                    ].map(p => (
                                        <span key={p.label} style={{
                                            fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700,
                                            padding: '2px 7px', textTransform: 'uppercase' as const, letterSpacing: '1px',
                                            background: p.status === 'PASS' ? 'rgba(63,185,80,0.10)' : p.status === 'FAIL' ? C.redBg : C.surface3,
                                            color: p.status === 'PASS' ? C.green : p.status === 'FAIL' ? C.red : C.text3,
                                            border: `1px solid ${p.status === 'PASS' ? 'rgba(63,185,80,0.25)' : p.status === 'FAIL' ? 'rgba(232,0,45,0.25)' : C.border}`,
                                        }}>
                                            {p.label} {p.status === 'PASS' ? 'PASS' : p.status === 'FAIL' ? 'FAIL' : '—'}
                                        </span>
                                    ))}
                                </div>
                                {buyerScore.reason && <div style={{ fontFamily: F.body, fontSize: 11, color: C.text3, fontStyle: 'italic', marginTop: 4 }}>{buyerScore.reason}</div>}
                            </div>
                        );
                    })()}
                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                        <Btn color={C.text3} variant="outline" onClick={onClose} style={{ flex: 1 }}>CANCEL</Btn>
                        <Btn type="submit" disabled={saving || overCap} style={{ flex: 2, background: overCap ? C.surface3 : C.red }}>
                            {saving ? 'CREATING…' : overCap ? `CAP: ${fmt$(cap)}` : 'CREATE INVOICE'}
                        </Btn>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── Start Auction Modal ────────────────────────────────────────────────────

const StartAuctionModal: React.FC<{ invoice: InvoiceDto; onClose: () => void; onStart: (r: StartAuctionRequest) => Promise<void> }> = ({ invoice, onClose, onStart }) => {
    const maxDays = daysUntil(invoice.dueDate);
    const [durationDays, setDurationDays] = useState(Math.min(7, maxDays));
    const [startRate, setStartRate] = useState(99);
    const [reserveRate, setReserveRate] = useState(95);
    const [saving, setSaving] = useState(false);
    const endDate = new Date(Date.now() + durationDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '8px 12px',
        border: `1px solid ${C.border2}`,
        fontSize: 13, outline: 'none', boxSizing: 'border-box',
        background: C.surface2, color: C.text1, fontFamily: F.mono,
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 20, maxWidth: 420, width: '90%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontFamily: F.heading, fontWeight: 700, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '1px', fontSize: 16 }}>LAUNCH AUCTION</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: C.text3 }}>✕</button>
                </div>
                <div style={{ background: C.surface2, border: `1px solid ${C.border}`, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
                    <div style={{ fontFamily: F.heading, fontWeight: 700, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Invoice #{invoice.invoiceId}</div>
                    <div style={{ fontFamily: F.body, color: C.text3, fontSize: 12 }}>{invoice.description} · {fmt$(invoice.amount)} · Due {invoice.dueDate}</div>
                </div>
                <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onStart({ auctionDurationDays: durationDays, auctionDurationSecs: durationDays * 86400, startRate, reserveRate, eligibleBanks: [] }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Duration: <span style={{ color: C.teal, fontFamily: F.mono }}>{durationDays}d</span> · Closes {endDate}</label>
                        <input type="range" min={1} max={maxDays} value={durationDays} onChange={e => setDurationDays(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#e8002d' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 10, color: C.text3, marginTop: 2 }}>
                            <span>1d</span><span>{maxDays}d</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Opening Rate (%)</label>
                            <input type="number" step="0.1" value={startRate} onChange={e => setStartRate(parseFloat(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Reserve Rate (%)</label>
                            <input type="number" step="0.1" value={reserveRate} onChange={e => setReserveRate(parseFloat(e.target.value))} style={inputStyle} />
                        </div>
                    </div>
                    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, padding: '8px 12px', marginBottom: 14, fontFamily: F.body, fontSize: 12, color: C.text2 }}>
                        Sealed-bid auction. Lowest rate wins at close. Window closes <span style={{ fontFamily: F.mono, color: C.teal }}>{endDate}</span>.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Btn color={C.text3} variant="outline" onClick={onClose} style={{ flex: 1 }}>CANCEL</Btn>
                        <Btn type="submit" disabled={saving} style={{ flex: 2, background: C.red }}>
                            {saving ? 'LAUNCHING…' : 'LAUNCH AUCTION'}
                        </Btn>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── Auction Status Card (Company view) ──────────────────────────────────────

const AuctionStatusCard: React.FC<{ auction: FinancingAuctionDto; onClose: () => void; onCancel: () => void }> = ({ auction, onClose, onCancel }) => {
    const endTime = auction.auctionEndTime ? new Date(auction.auctionEndTime) : null;
    const now = Date.now();
    const msLeft = endTime ? Math.max(0, endTime.getTime() - now) : null;
    const daysLeft = msLeft != null ? Math.floor(msLeft / 86400000) : null;
    const hoursLeft = msLeft != null ? Math.floor((msLeft % 86400000) / 3600000) : null;
    const timeDisplay = daysLeft != null
        ? daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h` : `${hoursLeft}h`
        : `${Math.floor((auction.auctionDurationSecs ?? 86400) / 86400)}d`;
    const endDateStr = endTime ? endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const totalSecs = auction.auctionDurationSecs ?? 86400;
    const elapsed = endTime ? Math.max(0, totalSecs - (endTime.getTime() - now) / 1000) : 0;
    const progress = Math.min(1, elapsed / totalSecs);

    return (
        <Card style={{ borderLeft: `2px solid ${C.red}`, background: 'rgba(232,0,45,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                    <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text3, marginBottom: 2 }}>INV #{auction.invoiceId}</div>
                    <div style={{ fontFamily: F.heading, fontSize: 16, fontWeight: 700, color: C.text1 }}>{auction.description}</div>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: C.text3, marginTop: 2 }}>Face: {fmt$(auction.amount)} · Due {auction.dueDate}</div>
                </div>
                <StatusPill status={auction.status} />
            </div>

            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 10, color: C.text3, marginBottom: 4 }}>
                    <span>STARTED</span>
                    <span>CLOSES {endDateStr}</span>
                </div>
                <div style={{ height: 3, background: C.surface3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: C.red, width: `${progress * 100}%`, transition: 'width 1s ease-out' }} />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                <Stat label="Best Rate" value={auction.currentBestRate != null ? `${auction.currentBestRate.toFixed(1)}%` : '—'} color={C.teal} />
                <Stat label="Bids" value={auction.bidCount ?? 0} color={C.amber} />
                <Stat label="Time Left" value={<span style={{ fontSize: 14 }}>{timeDisplay}</span>} color={C.red} />
            </div>

            <div style={{ background: C.surface2, border: `1px solid ${C.border}`, padding: '8px 12px', fontFamily: F.body, fontSize: 12, color: C.text2, marginBottom: 12 }}>
                Bids are sealed — only best rate and bid count visible. Winner revealed at close.
            </div>

            {(auction.bidCount ?? 0) > 0 && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>Verified Bidders</div>
                    {Array.from({ length: auction.bidCount ?? 0 }, (_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: 'rgba(63,185,80,0.05)', border: `1px solid rgba(63,185,80,0.15)`, marginBottom: 2, fontSize: 12 }}>
                            <span style={{ fontFamily: F.heading, fontWeight: 700, color: C.green }}>BANK {i + 1}</span>
                            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, color: C.green, background: 'rgba(63,185,80,0.10)', border: '1px solid rgba(63,185,80,0.25)', padding: '1px 6px', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>CERTIFIED</span>
                            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text3, marginLeft: 'auto' }}>SEALED</span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
                <Btn color={C.text3} variant="outline" small onClick={onCancel}>CANCEL AUCTION</Btn>
                <Btn style={{ flex: 1, background: C.red }} onClick={onClose}>
                    CLOSE &amp; SETTLE
                </Btn>
            </div>
        </Card>
    );
};

// ─── Trust Score Panel ──────────────────────────────────────────────────────

const TIER_CFG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
    PLATINUM:    { label: 'PLATINUM',    color: C.text1,  bg: C.surface3, border: C.border2, icon: '◆' },
    GOLD:        { label: 'GOLD',        color: '#d29922', bg: 'var(--amber-bg)', border: 'rgba(210,153,34,0.25)', icon: '▲' },
    SILVER:      { label: 'SILVER',      color: C.text2,  bg: C.surface3, border: C.border, icon: '●' },
    PROVISIONAL: { label: 'PROVISIONAL', color: '#00b4a6', bg: 'var(--teal-bg)', border: 'rgba(0,180,166,0.25)', icon: '○' },
    UNRATED:     { label: 'UNRATED',     color: C.text3,  bg: C.surface3, border: C.border, icon: '—' },
};

const ProofRow: React.FC<{ label: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, status, points }) => {
    const cfg = status === 'PASS'
        ? { color: C.green, bg: 'rgba(63,185,80,0.05)', border: 'rgba(63,185,80,0.15)' }
        : status === 'FAIL'
        ? { color: C.red, bg: C.redBg, border: 'rgba(232,0,45,0.15)' }
        : { color: C.amber, bg: C.amberBg, border: 'rgba(210,153,34,0.15)' };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: cfg.bg, border: `1px solid ${cfg.border}`, marginBottom: 2 }}>
            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, color: cfg.color, textTransform: 'uppercase' as const, letterSpacing: '1px', width: 40 }}>{status}</span>
            <span style={{ flex: 1, fontFamily: F.body, fontSize: 12, fontWeight: 600, color: C.text2 }}>{label}</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: cfg.color }}>{points}pt</span>
        </div>
    );
};

const BuyerProofRow: React.FC<{ label: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, status, points }) => {
    const cfg = status === 'PASS'
        ? { color: C.green, bg: 'rgba(63,185,80,0.05)', border: 'rgba(63,185,80,0.15)' }
        : status === 'FAIL'
        ? { color: C.red, bg: C.redBg, border: 'rgba(232,0,45,0.15)' }
        : { color: C.text3, bg: C.surface3, border: C.border };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: cfg.bg, border: `1px solid ${cfg.border}`, marginBottom: 2 }}>
            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, color: cfg.color, textTransform: 'uppercase' as const, letterSpacing: '1px', width: 50 }}>{status}</span>
            <span style={{ flex: 1, fontFamily: F.body, fontSize: 12, fontWeight: 600, color: C.text2 }}>{label}</span>
            {status === 'PENDING'
                ? <span style={{ fontFamily: F.mono, fontSize: 11, color: C.text3, fontStyle: 'italic' }}>—</span>
                : <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: cfg.color }}>{points}pt</span>
            }
        </div>
    );
};

// ─── Company Identity Card ──────────────────────────────────────────────────

const CompanyIdentityCard: React.FC<{
    name: string;
    sector?: string | null;
    trustScore: TrustScoreData | null;
    loadingTrust: boolean;
    onRefresh: () => void;
}> = ({ name, sector, trustScore, loadingTrust, onRefresh }) => {
    const [showProofs, setShowProofs] = useState(false);
    const tier = trustScore ? (TIER_CFG[trustScore.tier] ?? TIER_CFG.UNRATED) : null;
    const pct = trustScore && trustScore.maxPossibleScore > 0
        ? (trustScore.totalScore / trustScore.maxPossibleScore) * 100
        : 0;

    const proofs: Array<{ label: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = trustScore ? [
        { label: 'Proof 1 — Identity & Registration',    status: trustScore.proof1_status, points: trustScore.proof1_points },
        { label: 'Proof 2 — Financial Health',           status: trustScore.proof2_status, points: trustScore.proof2_points },
        { label: 'Proof 3 — Payment History',            status: trustScore.proof3_status, points: trustScore.proof3_points },
        { label: 'Proof 4 — ZK Compliance Attestation', status: trustScore.proof4_status, points: trustScore.proof4_points },
    ] : [];

    return (
        <GlassCard style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: F.heading, fontWeight: 700, fontSize: 16, color: C.text1 }}>{name}</span>
                        {sector && (
                            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, background: C.surface3, color: C.text2, padding: '2px 7px', border: `1px solid ${C.border}`, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>{sector}</span>
                        )}
                    </div>
                    {trustScore && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', background: tier!.bg, color: tier!.color, border: `1px solid ${tier!.border}`, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                                {tier!.icon} {tier!.label}
                            </span>
                            {trustScore.certified && <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(63,185,80,0.10)', color: C.green, border: '1px solid rgba(63,185,80,0.25)', padding: '2px 7px', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>CERTIFIED</span>}
                            {trustScore.invoiceValueCap != null && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.amber, fontWeight: 700 }}>CAP: ${trustScore.invoiceValueCap.toLocaleString()}</span>}
                        </div>
                    )}
                    {!trustScore && !loadingTrust && <div style={{ fontFamily: F.body, fontSize: 12, color: C.text3, marginTop: 4 }}>No trust score yet</div>}
                    {loadingTrust && !trustScore && (
                        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text3, marginTop: 4 }}>
                            Computing trust score…
                        </div>
                    )}
                </div>

                {trustScore && (
                    <div style={{ textAlign: 'right', minWidth: 100 }}>
                        <div style={{ fontFamily: F.mono, fontSize: 28, fontWeight: 900, color: C.teal, lineHeight: 1 }}>
                            {trustScore.totalScore}
                            <span style={{ fontSize: 13, color: C.text3, fontWeight: 600 }}>/{trustScore.maxPossibleScore}</span>
                        </div>
                        <div style={{ fontFamily: F.heading, fontSize: '0.59rem', color: C.text3, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>ZK Trust Score</div>
                        <div style={{ width: 100, height: 3, background: C.surface3, overflow: 'hidden', marginLeft: 'auto' }}>
                            <div style={{ height: '100%', background: C.teal, width: `${pct}%`, transition: 'width 1s ease-out' }} />
                        </div>
                        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.text3, marginTop: 2 }}>{pct.toFixed(0)}%</div>
                    </div>
                )}
            </div>

            {trustScore && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button onClick={() => setShowProofs(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: F.heading, fontSize: 11, fontWeight: 700, color: C.teal, display: 'flex', alignItems: 'center', gap: 4, padding: 0, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                            ZK PROOF BREAKDOWN <span style={{ fontSize: 10 }}>{showProofs ? '▲' : '▼'}</span>
                        </button>
                        <Btn small color={C.text3} variant="ghost" onClick={onRefresh} disabled={loadingTrust}>
                            {loadingTrust ? '…' : 'REFRESH'}
                        </Btn>
                    </div>
                    <AnimatePresence>
                        {showProofs && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden', marginTop: 8 }}>
                                {proofs.map(p => <ProofRow key={p.label} {...p} />)}
                                {trustScore.reason && <div style={{ fontFamily: F.body, fontSize: 11, color: C.text3, fontStyle: 'italic', marginTop: 4 }}>{trustScore.reason}</div>}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {!trustScore && !loadingTrust && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <Btn small onClick={onRefresh} style={{ background: C.teal }}>
                        GENERATE ZK TRUST SCORE
                    </Btn>
                </div>
            )}
        </GlassCard>
    );
};

// ─── Company Dashboard ──────────────────────────────────────────────────────

type CompanyTab = 'invoices' | 'auction' | 'financed' | 'archive';

const CompanyDashboard: React.FC = () => {
    const { invoices, auctions, financedInvoices, paidInvoices, fetchAll, createInvoice, deleteInvoice, startAuction, cancelAuction, closeAuction, payFinancedInvoice, trustScore, loadingTrust, fetchTrustScore, refreshTrustScore } = useInvoiceFinance();
    const { myProfile } = useProfile();
    const [tab, setTab] = useState<CompanyTab>('invoices');
    const [showCreate, setShowCreate] = useState(false);
    const [startAuctionInvoice, setStartAuctionInvoice] = useState<InvoiceDto | null>(null);
    const [closeResult, setCloseResult] = useState<CloseAuctionResult | null>(null);

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const hasActive = openAuctions.length > 0;
    const activeAuction = openAuctions[0];

    useEffect(() => {
        fetchAll();
        fetchTrustScore();
        const iv = setInterval(fetchAll, 15000);
        return () => clearInterval(iv);
    }, []);

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 14px 32px' }}>
            <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 2px', fontFamily: F.heading, fontWeight: 700, fontSize: 18, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                    INVOICE MANAGEMENT
                </h2>
                <p style={{ margin: 0, fontFamily: F.body, color: C.text3, fontSize: 13 }}>Submit invoices for financing. Receive early payment.</p>
            </div>

            {myProfile && (
                <CompanyIdentityCard
                    name={myProfile.displayName ?? ''}
                    sector={myProfile.sector ?? null}
                    trustScore={trustScore}
                    loadingTrust={loadingTrust}
                    onRefresh={refreshTrustScore}
                />
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <Stat label="Pending" value={invoices.length} color={C.red} />
                <Stat label="Auctions" value={openAuctions.length} color={openAuctions.length > 0 ? C.amber : C.text3} />
                <Stat label="Financed" value={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} color={C.green} />
                <Stat label="Paid" value={paidInvoices.length} color={C.text3} />
            </div>

            <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.border}`, marginBottom: 16, flexWrap: 'wrap' }}>
                <Tab label="My Invoices" active={tab === 'invoices'} count={invoices.length} onClick={() => setTab('invoices')} accent={C.red} />
                <Tab label="Live Auction" active={tab === 'auction'} count={openAuctions.length} onClick={() => setTab('auction')} accent={C.red} />
                <Tab label="Financed" active={tab === 'financed'} count={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} onClick={() => setTab('financed')} accent={C.red} />
                <Tab label="Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.red} />
            </div>

            <AnimatePresence>
                {closeResult && (
                    <div style={{ background: closeResult.noWinner ? C.amberBg : 'rgba(63,185,80,0.05)', border: `1px solid ${closeResult.noWinner ? 'rgba(210,153,34,0.25)' : 'rgba(63,185,80,0.25)'}`, padding: '10px 14px', marginBottom: 12, position: 'relative' }}>
                        {closeResult.noWinner
                            ? <span style={{ fontFamily: F.body, fontSize: 13, color: C.amber }}>Auction closed with no bids. Invoice returned.</span>
                            : <span style={{ fontFamily: F.body, fontSize: 13, color: C.green }}>Settled! {closeResult.winningInstitutionDisplayName ?? 'An institution'} won at <span style={{ fontFamily: F.mono }}>{closeResult.winningRate?.toFixed(2)}%</span> — received <span style={{ fontFamily: F.mono }}>{fmt$(closeResult.purchaseAmount)}</span></span>
                        }
                        <button onClick={() => setCloseResult(null)} style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: C.text3 }}>✕</button>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {tab === 'invoices' && (
                    <div key="invoices">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <h4 style={{ margin: 0, fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>MY INVOICES</h4>
                            <Btn onClick={() => setShowCreate(true)} style={{ background: C.red }}>+ NEW INVOICE</Btn>
                        </div>
                        {invoices.length === 0 ? (
                            <EmptyState icon="—" message="No invoices yet. Create your first to start." />
                        ) : (
                            <div>
                                {invoices.map(inv => (
                                    <Card key={inv.contractId}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                                    <span style={{ fontFamily: F.mono, fontWeight: 700, color: C.text1, fontSize: 13 }}>#{inv.invoiceId}</span>
                                                    <StatusPill status={inv.status} />
                                                </div>
                                                <div style={{ fontFamily: F.body, fontSize: 14, fontWeight: 600, color: C.text1 }}>{inv.description}</div>
                                                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text3, marginTop: 2 }}>
                                                    {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)}d left
                                                </div>
                                                <div style={{ marginTop: 4 }}>
                                                    <span style={{
                                                        fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700,
                                                        textTransform: 'uppercase' as const, letterSpacing: '1px',
                                                        padding: '2px 7px',
                                                        background: daysUntil(inv.dueDate) <= 30 ? C.redBg : daysUntil(inv.dueDate) <= 60 ? C.amberBg : C.tealBg,
                                                        color: daysUntil(inv.dueDate) <= 30 ? C.red : daysUntil(inv.dueDate) <= 60 ? C.amber : C.teal,
                                                        border: `1px solid ${daysUntil(inv.dueDate) <= 30 ? 'rgba(232,0,45,0.25)' : daysUntil(inv.dueDate) <= 60 ? 'rgba(210,153,34,0.25)' : 'rgba(0,180,166,0.25)'}`,
                                                    }}>
                                                        {daysUntil(inv.dueDate) > 60 ? 'LOW URGENCY' : daysUntil(inv.dueDate) > 30 ? 'MEDIUM' : 'URGENT'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 12 }}>
                                                <Btn small color={C.text3} variant="outline" onClick={() => deleteInvoice(inv.contractId)}>DEL</Btn>
                                                {!hasActive && <Btn small style={{ background: C.red }} onClick={() => setStartAuctionInvoice(inv)}>AUCTION</Btn>}
                                                {hasActive && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.text3, paddingTop: 4 }}>active</span>}
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'auction' && (
                    <div key="auction">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>LIVE AUCTION</h4>
                        {!hasActive ? (
                            <EmptyState icon="—" message="No active auction. Start one from My Invoices." />
                        ) : (
                            <AuctionStatusCard
                                auction={activeAuction}
                                onClose={async () => { const r = await closeAuction(activeAuction.contractId); if (r) setCloseResult(r); }}
                                onCancel={() => cancelAuction(activeAuction.contractId)}
                            />
                        )}
                    </div>
                )}

                {tab === 'financed' && (
                    <div key="financed">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>FINANCED</h4>
                        {financedInvoices.filter(i => i.paymentStatus !== 'PAID').length === 0 ? (
                            <EmptyState icon="—" message="No financed invoices yet." />
                        ) : (
                            <div>
                                {financedInvoices.filter(i => i.paymentStatus !== 'PAID').map(inv => (
                                    <GlassCard key={inv.contractId}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontFamily: F.mono, fontWeight: 700, color: C.text1, marginBottom: 2, fontSize: 13 }}>#{inv.invoiceId}</div>
                                                <div style={{ fontFamily: F.body, fontSize: 13, color: C.text1 }}>{inv.description}</div>
                                                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text3, marginTop: 2 }}>Face: {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)}d</div>
                                            </div>
                                            <Btn color={C.green} onClick={() => payFinancedInvoice(inv.contractId)}>PAY</Btn>
                                        </div>
                                    </GlassCard>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'archive' && (
                    <div key="archive">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>SETTLED</h4>
                        {paidInvoices.length === 0 ? (
                            <EmptyState icon="—" message="No paid invoices yet." />
                        ) : (
                            <div>
                                {paidInvoices.map(inv => (
                                    <GlassCard key={inv.contractId} style={{ padding: '10px 14px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                            <span style={{ fontFamily: F.body, color: C.text1 }}>#{inv.invoiceId} — {inv.description}</span>
                                            <span style={{ fontFamily: F.mono, fontWeight: 700, color: C.green }}>{fmt$(inv.amount)}</span>
                                        </div>
                                        <EvmSettlementBadge bridgeState={(inv as any).bridgeState} txHash={(inv as any).paymentTxHash} />
                                    </GlassCard>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showCreate && <InvoiceCreateModal onClose={() => setShowCreate(false)} onCreate={createInvoice} />}
                {startAuctionInvoice && (
                    <StartAuctionModal
                        invoice={startAuctionInvoice}
                        onClose={() => setStartAuctionInvoice(null)}
                        onStart={r => startAuction(startAuctionInvoice.contractId, r)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

// ─── Auction Bid Card (Institution view) ────────────────────────────────────

const AuctionBidCard: React.FC<{
    auction: FinancingAuctionDto;
    bidStatus?: { hasBid: boolean; isWinning: boolean; myRate?: number | null; currentBestRate?: number | null; averageBid?: number | null };
    onBid: (rate: number) => Promise<any>;
    bidBlocked?: boolean;
    bidBlockedReason?: string;
}> = ({ auction, bidStatus, onBid, bidBlocked, bidBlockedReason }) => {
    const [rate, setRate] = useState<string>(bidStatus?.myRate != null ? bidStatus.myRate.toFixed(2) : auction.reserveRate.toFixed(2));
    const [bidding, setBidding] = useState(false);
    const endTime = auction.auctionEndTime ? new Date(auction.auctionEndTime) : null;
    const daysLeft = endTime ? Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 86400000)) : null;
    const endDateStr = endTime ? endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    const hasBid = bidStatus?.hasBid ?? false;
    const isWinning = bidStatus?.isWinning ?? false;
    const bestRate = bidStatus?.currentBestRate ?? auction.currentBestRate;

    const supplierTier: string | null = (auction as any).supplierTier ?? null;
    const supplierCertified: boolean = (auction as any).supplierCertified ?? false;
    const tierCfg = supplierTier ? (TIER_CFG[supplierTier] ?? TIER_CFG.PROVISIONAL) : null;

    const buyerTier: string | null = (auction as any).buyerTier ?? null;
    const buyerCertified: boolean = (auction as any).buyerCertified ?? false;
    const buyerTierCfg = buyerTier ? (TIER_CFG[buyerTier] ?? TIER_CFG.PROVISIONAL) : null;
    const combinedRisk: string | null = (auction as any).combinedRisk ?? null;
    const highRiskBuyer: boolean = (auction as any).highRiskBuyer ?? false;
    const buyerTrustScore: number | null = (auction as any).buyerTrustScore ?? null;
    const buyerMaxScore: number | null = (auction as any).buyerMaxScore ?? null;
    const buyerProof1Status = ((auction as any).buyerProof1Status ?? 'PENDING') as 'PASS' | 'FAIL' | 'PENDING';
    const buyerProof2Status = ((auction as any).buyerProof2Status ?? 'PENDING') as 'PASS' | 'FAIL' | 'PENDING';
    const buyerProof3Status = ((auction as any).buyerProof3Status ?? 'PENDING') as 'PASS' | 'FAIL' | 'PENDING';
    const buyerProof4Status = ((auction as any).buyerProof4Status ?? 'PENDING') as 'PASS' | 'FAIL' | 'PENDING';
    const buyerReason: string | null = (auction as any).buyerReason ?? null;
    const [showBuyerProofs, setShowBuyerProofs] = useState(false);

    const handleBid = async () => {
        const r = parseFloat(rate);
        if (isNaN(r) || r <= 0) return;
        setBidding(true);
        try { await onBid(r); } finally { setBidding(false); }
    };

    return (
        <Card style={{
            borderLeft: highRiskBuyer ? `2px solid var(--red)` : hasBid ? `2px solid var(--amber)` : `1px solid ${C.border}`,
            background: highRiskBuyer ? 'rgba(232,0,45,0.03)' : hasBid ? 'rgba(210,153,34,0.03)' : C.surface,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: F.mono, fontWeight: 700, color: C.text1, fontSize: 13 }}>#{auction.invoiceId}</span>
                        {hasBid && (
                            <span style={{
                                fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700,
                                textTransform: 'uppercase' as const, letterSpacing: '1px',
                                padding: '2px 7px',
                                background: isWinning ? 'rgba(63,185,80,0.10)' : C.amberBg,
                                color: isWinning ? C.green : C.amber,
                                border: `1px solid ${isWinning ? 'rgba(63,185,80,0.25)' : 'rgba(210,153,34,0.25)'}`,
                            }}>
                                {isWinning ? 'WINNING' : 'BID PLACED'}
                            </span>
                        )}
                    </div>
                    <div style={{ fontFamily: F.body, fontSize: 14, fontWeight: 600, color: C.text1, marginBottom: 4 }}>{auction.description}</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: F.mono, fontSize: 12, color: C.text3 }}>
                        <span>{fmt$(auction.amount)}</span>
                        <span>Due {auction.dueDate}</span>
                        {daysLeft != null && <span>{daysLeft > 0 ? `Closes ${endDateStr}` : 'Closing soon'}</span>}
                    </div>
                </div>
                <div style={{ flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginBottom: 4 }}>
                        {tierCfg && (
                            <div style={{ padding: '4px 6px', background: tierCfg.bg, border: `1px solid ${tierCfg.border}`, textAlign: 'center' }}>
                                <div style={{ fontFamily: F.heading, fontSize: 8, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 1 }}>SUPPLIER</div>
                                <div style={{ fontFamily: F.heading, fontSize: 9, fontWeight: 700, color: tierCfg.color }}>{tierCfg.label}</div>
                                {supplierCertified && <div style={{ fontFamily: F.mono, fontSize: 8, color: C.green }}>✓</div>}
                            </div>
                        )}
                        {buyerTierCfg && (
                            <div style={{ padding: '4px 6px', background: buyerTierCfg.bg, border: `1px solid ${highRiskBuyer ? 'rgba(232,0,45,0.4)' : buyerTierCfg.border}`, textAlign: 'center' }}>
                                <div style={{ fontFamily: F.heading, fontSize: 8, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: 1 }}>BUYER</div>
                                <div style={{ fontFamily: F.heading, fontSize: 9, fontWeight: 700, color: highRiskBuyer ? C.red : buyerTierCfg.color }}>{buyerTierCfg.label}</div>
                                {highRiskBuyer && <div style={{ fontFamily: F.mono, fontSize: 8, color: C.red }}>!</div>}
                                {buyerCertified && !highRiskBuyer && <div style={{ fontFamily: F.mono, fontSize: 8, color: C.green }}>✓</div>}
                            </div>
                        )}
                        {!tierCfg && !buyerTierCfg && (
                            <div style={{ width: 36, height: 36, background: C.surface3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.text3 }}>—</span>
                            </div>
                        )}
                    </div>
                    {combinedRisk && (
                        <div style={{
                            fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
                            textAlign: 'center', textTransform: 'uppercase' as const, letterSpacing: '1px',
                            background: combinedRisk === 'LOW RISK' ? 'rgba(63,185,80,0.10)' : combinedRisk === 'MEDIUM RISK' ? C.amberBg : C.redBg,
                            color: combinedRisk === 'LOW RISK' ? C.green : combinedRisk === 'MEDIUM RISK' ? C.amber : C.red,
                            border: `1px solid ${combinedRisk === 'LOW RISK' ? 'rgba(63,185,80,0.25)' : combinedRisk === 'MEDIUM RISK' ? 'rgba(210,153,34,0.25)' : 'rgba(232,0,45,0.25)'}`,
                        }}>
                            {combinedRisk}
                        </div>
                    )}
                    {bestRate != null && (
                        <div style={{ marginTop: 4, textAlign: 'right' }}>
                            <div style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 900, color: C.teal }}>{bestRate.toFixed(2)}%</div>
                            <div style={{ fontFamily: F.heading, fontSize: 9, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>BEST RATE</div>
                        </div>
                    )}
                </div>
            </div>

            {hasBid && bidStatus?.myRate != null && (
                <div style={{ background: isWinning ? 'rgba(63,185,80,0.05)' : C.surface2, border: `1px solid ${isWinning ? 'rgba(63,185,80,0.15)' : C.border}`, padding: '6px 10px', marginBottom: 8, fontFamily: F.body, fontSize: 12, color: isWinning ? C.green : C.text2 }}>
                    Your bid: <span style={{ fontFamily: F.mono, fontWeight: 700 }}>{bidStatus.myRate.toFixed(2)}%</span>
                    {isWinning ? ' — WINNING' : bestRate != null ? ` — Best: ${bestRate.toFixed(2)}%` : ''}
                    {bidStatus?.averageBid != null && (
                        <span style={{ marginLeft: 8, fontFamily: F.mono, color: C.amber }}>Avg: {(bidStatus.averageBid as number).toFixed(2)}%</span>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: C.text3, display: 'block', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '2.5px' }}>
                        {hasBid ? 'Update Rate (%)' : 'Offered Rate (%)'}
                    </label>
                    <input
                        type="number" step="0.01" min={auction.reserveRate} max={auction.startRate}
                        value={rate} onChange={e => setRate(e.target.value)}
                        placeholder={`${auction.reserveRate.toFixed(1)} – ${auction.startRate.toFixed(1)}`}
                        style={{
                            width: '100%', padding: '8px 12px',
                            border: `1px solid ${C.border2}`,
                            fontSize: 13, outline: 'none', boxSizing: 'border-box',
                            background: C.surface2, color: C.text1, fontFamily: F.mono,
                        }}
                    />
                    <div style={{ fontFamily: F.body, fontSize: 11, color: C.text3, marginTop: 2 }}>
                        Lower rate = better chance. Bids sealed.
                        {(auction.averageBid != null) && (
                            <span style={{ marginLeft: 8, fontFamily: F.mono, fontWeight: 700, color: C.amber }}>
                                Mkt avg: {(auction.averageBid as number).toFixed(2)}%
                            </span>
                        )}
                    </div>
                </div>
                <Btn
                    color={C.amber}
                    disabled={bidding || !rate || bidBlocked}
                    onClick={handleBid}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0, background: bidding || bidBlocked ? C.surface3 : C.amber, cursor: bidBlocked ? 'not-allowed' : 'pointer' }}
                >
                    {bidBlocked ? 'BLOCKED' : bidding ? '…' : hasBid ? 'UPDATE BID' : 'PLACE BID'}
                </Btn>
            </div>
            {bidBlocked && bidBlockedReason && (
                <div style={{ fontFamily: F.body, fontSize: 11, color: C.red, fontWeight: 600, marginTop: 4 }}>{bidBlockedReason}</div>
            )}

            {buyerTierCfg && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <button onClick={() => setShowBuyerProofs(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: F.heading, fontSize: 11, fontWeight: 700, color: C.teal, display: 'flex', alignItems: 'center', gap: 4, padding: 0, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                        BUYER ZK TRUST <span style={{ fontSize: 10 }}>{showBuyerProofs ? '▲' : '▼'}</span>
                    </button>
                    <AnimatePresence>
                        {showBuyerProofs && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden', marginTop: 6 }}>
                                {buyerTrustScore != null && buyerMaxScore != null && (
                                    <div style={{ fontFamily: F.body, fontSize: 12, color: C.text3, marginBottom: 6 }}>
                                        Buyer Score: <span style={{ fontFamily: F.mono, fontWeight: 700, color: C.text1 }}>{buyerTrustScore}/{buyerMaxScore}</span>
                                        {buyerTier && <span style={{ marginLeft: 8, fontFamily: F.heading, fontWeight: 700, color: buyerTierCfg.color }}>{buyerTier}</span>}
                                    </div>
                                )}
                                <BuyerProofRow label="P1 — Payment History (≥90%)" status={buyerProof1Status} points={3} />
                                <BuyerProofRow label="P2 — Invoice Confirm Rate (≥80%)" status={buyerProof2Status} points={2} />
                                <BuyerProofRow label="P3 — Dispute Record (≤5%)" status={buyerProof3Status} points={2} />
                                <BuyerProofRow label="P4 — Payment Timeliness (≥85%)" status={buyerProof4Status} points={3} />
                                {buyerReason && <div style={{ fontFamily: F.body, fontSize: 11, color: C.text3, fontStyle: 'italic', marginTop: 4 }}>{buyerReason}</div>}
                                {highRiskBuyer && <div style={{ fontFamily: F.body, fontSize: 12, color: C.red, fontWeight: 700, marginTop: 4, padding: '4px 8px', background: C.redBg, border: '1px solid rgba(232,0,45,0.25)' }}>UNRATED buyer — no verified payment history.</div>}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </Card>
    );
};

// ─── Bank Certification Banner ──────────────────────────────────────────────

const BANK_TIER_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
    CERTIFIED:      { label: 'CERTIFIED',      color: C.green,  bg: 'rgba(63,185,80,0.05)',  border: 'rgba(63,185,80,0.25)' },
    PROBATIONARY:   { label: 'PROBATIONARY',   color: C.amber,  bg: C.amberBg,               border: 'rgba(210,153,34,0.25)' },
    SUSPENDED:      { label: 'SUSPENDED',      color: C.red,    bg: C.redBg,                 border: 'rgba(232,0,45,0.25)' },
    RATE_VIOLATION: { label: 'RATE VIOLATION',  color: C.red,    bg: C.redBg,                 border: 'rgba(232,0,45,0.25)' },
};

const BankProofRow: React.FC<{ label: string; detail: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, detail, status, points }) => {
    const cfg = status === 'PASS'
        ? { color: C.green, bg: 'rgba(63,185,80,0.05)', border: 'rgba(63,185,80,0.15)' }
        : status === 'FAIL'
        ? { color: C.red, bg: C.redBg, border: 'rgba(232,0,45,0.15)' }
        : { color: C.amber, bg: C.amberBg, border: 'rgba(210,153,34,0.15)' };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: cfg.bg, border: `1px solid ${cfg.border}`, marginBottom: 2 }}>
            <span style={{ fontFamily: F.heading, fontSize: '0.65rem', fontWeight: 700, color: cfg.color, textTransform: 'uppercase' as const, letterSpacing: '1px', width: 40 }}>{status}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F.heading, fontSize: 12, fontWeight: 700, color: cfg.color }}>{label}</div>
                <div style={{ fontFamily: F.body, fontSize: 11, color: C.text3 }}>{detail}</div>
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 700, color: cfg.color }}>{points}/1</span>
        </div>
    );
};

const BankCertBanner: React.FC<{ bs: BankTrustScoreData; loading: boolean; onRefresh: () => void }> = ({ bs, loading, onRefresh }) => {
    const tier = BANK_TIER_CFG[bs.tier] ?? BANK_TIER_CFG.SUSPENDED;
    const [expanded, setExpanded] = useState(false);

    return (
        <GlassCard style={{ marginBottom: 14, border: `1px solid ${tier.border}`, background: tier.bg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: F.heading, fontSize: 13, fontWeight: 700, color: tier.color, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>{tier.label}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: tier.color, fontWeight: 700 }}>{bs.totalScore}/3</span>
                    {bs.canBid
                        ? <span style={{ fontFamily: F.heading, fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>CAN BID</span>
                        : <span style={{ fontFamily: F.heading, fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>DISABLED</span>
                    }
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    <Btn small color={tier.color} variant="ghost" onClick={() => setExpanded(v => !v)}>
                        {expanded ? 'HIDE' : 'DETAILS'}
                    </Btn>
                    <Btn small color={C.text3} variant="ghost" onClick={onRefresh} disabled={loading}>
                        {loading ? '…' : 'REFRESH'}
                    </Btn>
                </div>
            </div>

            {!bs.canBid && bs.reason && (
                <div style={{ marginTop: 6, fontFamily: F.body, fontSize: 11, color: tier.color, fontWeight: 600 }}>Reason: {bs.reason}</div>
            )}

            <AnimatePresence>
                {expanded && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: 8 }}>
                        <BankProofRow label="X  Liquidity" detail={bs.proofX_status === 'PASS' ? 'Reserves cover ≥110% of offer' : 'Reserves insufficient'} status={bs.proofX_status} points={bs.proofX_points} />
                        <BankProofRow label="Y  Legitimacy" detail={bs.proofY_status === 'PASS' ? 'Node active ≥30 days' : bs.proofY_status === 'PENDING' ? 'Node not yet 30 days old' : 'Node age check failed'} status={bs.proofY_status} points={bs.proofY_points} />
                        <BankProofRow label="Z  Rate Range" detail={bs.proofZ_status === 'PASS' ? 'Rate within network benchmark' : 'Rate exceeds network average by >20%'} status={bs.proofZ_status} points={bs.proofZ_points} />
                        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.text3, marginTop: 4 }}>
                            Verified: {bs.timestamp ? new Date(bs.timestamp).toLocaleString() : '—'}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </GlassCard>
    );
};

// ─── Institution Dashboard ──────────────────────────────────────────────────

type InstitutionTab = 'discover' | 'loans' | 'archive';

const InstitutionDashboard: React.FC = () => {
    const { auctions, financedInvoices, paidInvoices, bankOwnerships, bidStatuses, fetchAll, placeBid, getMyBidStatus, bankScore, loadingBankScore, fetchBankScore, refreshBankScore } = useInvoiceFinance();
    const [tab, setTab] = useState<InstitutionTab>('discover');

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const activeLoans = financedInvoices.filter(i => i.paymentStatus !== 'PAID');

    useEffect(() => {
        fetchAll();
        fetchBankScore();
        const iv = setInterval(fetchAll, 15000);
        return () => clearInterval(iv);
    }, []);

    useEffect(() => {
        openAuctions.forEach(a => { if (!bidStatuses[a.contractId]) getMyBidStatus(a.contractId); });
    }, [auctions]);

    const bidBlocked = bankScore ? !bankScore.canBid : false;

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 14px 32px' }}>
            <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: '0 0 2px', fontFamily: F.heading, fontWeight: 700, fontSize: 18, color: C.text1, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                    FINANCING OPPORTUNITIES
                </h2>
                <p style={{ margin: 0, fontFamily: F.body, color: C.text3, fontSize: 13 }}>Browse live auctions, submit bids, earn yield at maturity.</p>
            </div>

            {bankScore && <BankCertBanner bs={bankScore} loading={loadingBankScore} onRefresh={refreshBankScore} />}
            {!bankScore && !loadingBankScore && (
                <GlassCard style={{ marginBottom: 14, textAlign: 'center', padding: '12px 16px' }}>
                    <Btn color={C.amber} onClick={refreshBankScore} disabled={loadingBankScore}>
                        {loadingBankScore ? 'GENERATING…' : 'GENERATE BANK CERTIFICATION'}
                    </Btn>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: C.text3, marginTop: 4 }}>Required before placing bids</div>
                </GlassCard>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <Stat label="Open Auctions" value={openAuctions.length} color={C.red} />
                <Stat label="My Bids" value={Object.values(bidStatuses).filter(b => b.hasBid).length} color={C.amber} />
                <Stat label="Active Loans" value={activeLoans.length} color={C.green} />
                <Stat label="Settled" value={paidInvoices.length} color={C.text3} />
            </div>

            <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
                <Tab label="Discover" active={tab === 'discover'} count={openAuctions.length} onClick={() => setTab('discover')} accent={C.amber} />
                <Tab label="My Loans" active={tab === 'loans'} count={activeLoans.length} onClick={() => setTab('loans')} accent={C.amber} />
                <Tab label="Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.amber} />
            </div>

            <AnimatePresence mode="wait">
                {tab === 'discover' && (
                    <div key="discover">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>OPEN AUCTIONS</h4>
                        {openAuctions.length === 0 ? (
                            <EmptyState icon="—" message="No open auctions right now." />
                        ) : (
                            <div>
                                {openAuctions.map(a => (
                                    <AuctionBidCard
                                        key={a.contractId}
                                        auction={a}
                                        bidStatus={bidStatuses[a.contractId]}
                                        onBid={rate => placeBid(a.contractId, { offeredRate: rate })}
                                        bidBlocked={bidBlocked}
                                        bidBlockedReason={bankScore?.reason}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'loans' && (
                    <div key="loans">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>MY LOANS</h4>
                        {activeLoans.length === 0 ? (
                            <EmptyState icon="—" message="No active loans. Win an auction to start." />
                        ) : (
                            <div>
                                {activeLoans.map(inv => {
                                    const bo = bankOwnerships.find(b => b.invoiceId === inv.invoiceId);
                                    return (
                                        <GlassCard key={inv.contractId}>
                                            <div style={{ fontFamily: F.mono, fontWeight: 700, color: C.text1, marginBottom: 2, fontSize: 13 }}>#{inv.invoiceId}</div>
                                            <div style={{ fontFamily: F.body, fontSize: 13, color: C.text1, marginBottom: 8 }}>{inv.description}</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 6 }}>
                                                <Stat label="Face Value" value={fmt$(inv.amount)} color={C.amber} />
                                                {bo && <Stat label="Rate" value={`${bo.purchaseRate.toFixed(2)}%`} color={C.teal} />}
                                                {bo && <Stat label="Paid" value={fmt$(bo.purchaseAmount)} color={C.green} />}
                                            </div>
                                            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text3 }}>Due {inv.dueDate} · {daysUntil(inv.dueDate)}d to maturity</div>
                                            {bo && <div style={{ fontFamily: F.mono, fontSize: 12, color: C.green, fontWeight: 700, marginTop: 4 }}>Yield: {fmt$((bo.faceValue ?? inv.amount) - bo.purchaseAmount)}</div>}
                                        </GlassCard>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'archive' && (
                    <div key="archive">
                        <h4 style={{ margin: '0 0 10px', fontFamily: F.heading, fontWeight: 700, color: C.text1, fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '1px' }}>SETTLED LOANS</h4>
                        {paidInvoices.length === 0 ? (
                            <EmptyState icon="—" message="No settled loans yet." />
                        ) : (
                            <div>
                                {paidInvoices.map(inv => (
                                    <GlassCard key={inv.contractId} style={{ padding: '10px 14px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                            <span style={{ fontFamily: F.body, color: C.text1 }}>#{inv.invoiceId} — {inv.description}</span>
                                            <span style={{ fontFamily: F.mono, fontWeight: 700, color: C.green }}>{fmt$(inv.amount)}</span>
                                        </div>
                                        <EvmSettlementBadge bridgeState={(inv as any).bridgeState} txHash={(inv as any).paymentTxHash} />
                                    </GlassCard>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ─── Main DashboardView ─────────────────────────────────────────────────────

const DashboardView: React.FC = () => {
    const { user, loading: userLoading, fetchUser } = useUserStore();
    const { myProfile, fetchMyProfile, saveMyProfile } = useProfile();
    const navigate = useNavigate();

    useEffect(() => {
        fetchUser();
        fetchMyProfile();
    }, []);

    useEffect(() => {
        if (!userLoading && user === null) {
            navigate('/select-role');
        }
    }, [user, userLoading, navigate]);

    if (userLoading || (user !== null && myProfile === undefined)) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                    style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.red }}
                />
            </div>
        );
    }

    if (user === null) return null;

    if (!myProfile) return <ProfileSetupModal onSave={saveMyProfile} />;

    const isCompany = myProfile.type === 'COMPANY';

    return (
        <div style={{ minHeight: '100vh', paddingTop: 16 }}>
            {isCompany ? <CompanyDashboard /> : <InstitutionDashboard />}
        </div>
    );
};

export default DashboardView;
