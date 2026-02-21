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

// ─── Design tokens (all CSS vars — updates automatically with dark mode) ────

const C = {
    primary:  'var(--c-primary)',
    dark:     'var(--c-dark)',
    gold:     'var(--c-gold)',
    bg:       'var(--c-bg)',
    text:     'var(--c-text)',
    muted:    'var(--c-muted)',
    glass:    'var(--c-glass)',
    border:   'var(--c-border)',
    shadow:   'var(--c-shadow)',
    green:    '#10b981',
    amber:    '#f59e0b',
    gradient: 'var(--c-gradient)',
    instGrad: 'linear-gradient(135deg, var(--c-gold) 0%, var(--c-primary) 100%)',
};

// ─── Animation variants ─────────────────────────────────────────────────────

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = {
    hidden: { opacity: 0, y: 20, scale: 0.98 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 22 } },
};
const fadeIn = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.25 } },
    exit:   { opacity: 0, transition: { duration: 0.15 } },
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
    <motion.div
        variants={fadeUp}
        onClick={onClick}
        style={{
            background: C.glass,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: 20,
            marginBottom: 14,
            boxShadow: C.shadow,
            ...style,
        }}
    >
        {children}
    </motion.div>
);

// GlassCard is the same as Card — no tilt effect for simplicity
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
}> = ({ onClick, color = 'var(--c-primary)', variant = 'solid', small, disabled, children, style, type = 'button' }) => (
    <motion.button
        type={type}
        onClick={onClick}
        disabled={disabled}
        whileHover={{ scale: disabled ? 1 : 1.03 }}
        whileTap={{ scale: disabled ? 1 : 0.97 }}
        style={{
            padding: small ? '7px 14px' : '11px 20px',
            fontSize: small ? 12 : 14,
            fontWeight: 700,
            borderRadius: 10,
            border: variant === 'outline' ? `2px solid ${color}` : 'none',
            background: disabled ? 'var(--c-border)' : variant === 'solid' ? color : 'transparent',
            color: disabled ? 'var(--c-muted)' : variant === 'solid' ? '#fff' : color,
            cursor: disabled ? 'default' : 'pointer',
            boxShadow: (!disabled && variant === 'solid') ? '0 4px 14px rgba(79,70,229,0.20)' : 'none',
            fontFamily: 'inherit',
            ...style,
        }}
    >
        {children}
    </motion.button>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color = 'var(--c-primary)' }) => (
    <div style={{
        background: C.glass, backdropFilter: 'blur(12px)',
        borderRadius: 14, padding: '14px 18px', textAlign: 'center',
        border: `1px solid ${C.border}`, flex: 1,
    }}>
        <div style={{ fontSize: 26, fontWeight: 900, color }}>{value}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontWeight: 600 }}>{label}</div>
    </div>
);

const Tab: React.FC<{ label: string; active: boolean; count?: number; onClick: () => void; accent: string }> = ({
    label, active, count, onClick, accent,
}) => (
    <button
        onClick={onClick}
        style={{
            padding: '10px 18px', fontWeight: 700, fontSize: 14, border: 'none',
            background: 'none', cursor: 'pointer', position: 'relative',
            color: active ? accent : C.muted,
            borderBottom: active ? `3px solid ${accent}` : '3px solid transparent',
            marginBottom: -2,
            transition: 'color 0.2s',
        }}
    >
        {label}
        {count != null && count > 0 && (
            <span style={{
                marginLeft: 6, background: active ? accent : 'var(--c-border)',
                color: active ? '#fff' : C.muted,
                padding: '1px 7px', borderRadius: 999, fontSize: 11,
            }}>
                {count}
            </span>
        )}
    </button>
);

const EmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}
    >
        <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: 40, marginBottom: 12 }}
        >
            {icon}
        </motion.div>
        <div style={{ fontSize: 14 }}>{message}</div>
    </motion.div>
);

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const map: Record<string, { bg: string; fg: string }> = {
        CONFIRMED:            { bg: 'rgba(79,70,229,0.12)',  fg: C.primary },
        PENDING_CONFIRMATION: { bg: 'rgba(245,158,11,0.12)', fg: '#92400e' },
        IN_AUCTION:           { bg: 'rgba(124,58,237,0.12)', fg: C.gold },
        FINANCED:             { bg: 'rgba(16,185,129,0.12)', fg: '#065f46' },
        PAID:                 { bg: 'rgba(16,185,129,0.12)', fg: '#065f46' },
        OPEN:                 { bg: 'rgba(79,70,229,0.12)',  fg: C.primary },
        CLOSED:               { bg: 'rgba(107,114,128,0.12)', fg: C.muted },
    };
    const c = map[status] || { bg: 'rgba(107,114,128,0.12)', fg: '#374151' };
    return (
        <span style={{
            background: c.bg, color: c.fg, padding: '3px 10px',
            borderRadius: 999, fontSize: 11, fontWeight: 800,
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

const EvmSettlementBadge: React.FC<{ bridgeState?: string | null; txHash?: string | null }> = ({ bridgeState, txHash }) => {
    if (!bridgeState) return null;
    const cfg: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
        PENDING:    { label: 'Settlement Pending', bg: '#FFF3CD', fg: '#92400e', dot: '#f59e0b' },
        CONFIRMING: { label: 'Confirming on EVM',  bg: 'rgba(124,58,237,0.10)', fg: 'var(--c-gold)', dot: '#7c3aed' },
        CONFIRMED:  { label: 'EVM Confirmed',      bg: 'rgba(16,185,129,0.10)', fg: '#065f46', dot: '#10b981' },
    };
    const c = cfg[bridgeState] ?? { label: bridgeState, bg: 'rgba(107,114,128,0.10)', fg: C.muted, dot: '#6b7280' };
    return (
        <div style={{ background: c.bg, borderRadius: 8, padding: '8px 12px', marginTop: 10, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: txHash ? 4 : 0 }}>
                <motion.div
                    animate={bridgeState !== 'CONFIRMED' ? { opacity: [1, 0.3, 1] } : {}}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0 }}
                />
                <span style={{ fontWeight: 700, color: c.fg }}>EVM Settlement: {c.label}</span>
            </div>
            {txHash && (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: c.fg, opacity: 0.8 }}>
                    Tx: {txHash.substring(0, 12)}…
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
        <div style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: 14, background: 'rgba(79,70,229,0.04)', textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 4 }}>🤖 AI Invoice Parser</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Upload an invoice image or PDF to auto-fill fields</div>
            <label style={{ cursor: loading ? 'wait' : 'pointer' }}>
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
                <motion.span
                    whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                    style={{ display: 'inline-block', padding: '6px 18px', background: loading ? 'var(--c-border)' : C.primary, color: loading ? C.muted : '#fff', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                    {loading ? '⏳ Parsing…' : '📎 Upload Invoice'}
                </motion.span>
            </label>
            {status === 'parsed' && <div style={{ fontSize: 11, color: C.green, marginTop: 6, fontWeight: 700 }}>✅ {fileName} — fields populated</div>}
            {status === 'error' && <div style={{ fontSize: 11, color: C.primary, marginTop: 6 }}>⚠️ Parse failed — fill manually</div>}
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
    const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: C.glass, color: C.text };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div
                initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'var(--c-modal-bg)', borderRadius: 24, padding: 36, maxWidth: 520, width: '90%', boxShadow: '0 24px 60px rgba(0,0,0,0.20)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${C.border}` }}
            >
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <div style={{ fontSize: 44, marginBottom: 10 }}>📋</div>
                    <h2 style={{ margin: '8px 0 4px', fontWeight: 900, fontSize: 22, color: C.text }}>Set Up Your Profile</h2>
                    <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Tell us about your organization to get started</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                            style={{ flex: 1, padding: '12px 0', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', border: '2px solid', borderColor: form.type === t ? (t === 'COMPANY' ? C.primary : C.gold) : C.border, background: form.type === t ? 'rgba(79,70,229,0.08)' : 'transparent', color: form.type === t ? (t === 'COMPANY' ? C.primary : C.gold) : C.muted }}
                        >
                            {t === 'COMPANY' ? '🏭 Company' : '🏦 Institution'}
                        </button>
                    ))}
                </div>
                <form onSubmit={async (e) => { e.preventDefault(); if (!form.displayName?.trim()) return; setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>{form.type === 'COMPANY' ? 'Company' : 'Institution'} Name *</label>
                            <input value={form.displayName} onChange={set('displayName')} placeholder={form.type === 'COMPANY' ? 'Acme Corp' : 'First Capital Bank'} required style={inputStyle} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Sector</label>
                            <select value={form.sector ?? ''} onChange={set('sector')} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {SECTORS.map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Founded Year</label>
                            <input type="number" placeholder="2010" value={form.foundedYear ?? ''} onChange={setNum('foundedYear')} style={inputStyle} />
                        </div>
                        {form.type === 'COMPANY' && <>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Annual Revenue ($)</label>
                                <input type="number" placeholder="5000000" value={form.annualRevenue ?? ''} onChange={setNum('annualRevenue')} style={inputStyle} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Employees</label>
                                <input type="number" placeholder="50" value={form.employeeCount ?? ''} onChange={setNum('employeeCount')} style={inputStyle} />
                            </div>
                        </>}
                    </div>
                    <motion.button type="submit" disabled={saving || !form.displayName?.trim()} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        style={{ width: '100%', marginTop: 20, padding: '13px 0', background: saving || !form.displayName?.trim() ? 'var(--c-border)' : 'var(--c-gradient)', color: saving || !form.displayName?.trim() ? C.muted : '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: saving ? 'wait' : 'pointer', boxShadow: '0 4px 18px rgba(79,70,229,0.20)' }}
                    >
                        {saving ? 'Saving…' : 'Get Started →'}
                    </motion.button>
                </form>
            </motion.div>
        </motion.div>
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
    const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: C.glass, color: C.text };

    const isProvisional = trustScore?.tier === 'PROVISIONAL';
    const cap = trustScore?.invoiceValueCap ?? 5000;
    const amountNum = parseFloat(form.amount) || 0;
    const overCap = isProvisional && amountNum > cap;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'var(--c-modal-bg)', borderRadius: 24, padding: 28, maxWidth: 520, width: '90%', boxShadow: 'var(--c-shadow)', maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${C.border}` }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, color: C.text }}>New Invoice</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}>✕</button>
                </div>

                {isProvisional && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                        style={{ background: '#DBEAFE', border: '1.5px solid #93c5fd', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}
                    >
                        <div style={{ fontWeight: 800, color: '#1e40af', fontSize: 13, marginBottom: 4 }}>
                            🔄 Provisional Tier — Invoice cap: {fmt$(cap)}
                        </div>
                        <div style={{ fontSize: 12, color: '#1e3a8a' }}>
                            Complete more invoices to unlock higher limits. Proofs 2–4 are still building your history.
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            <span style={{ background: '#D1FAE5', color: '#065f46', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>P1 ✅ Legitimate</span>
                            <span style={{ background: '#FEF3C7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>P2 ⏳ Pending</span>
                            <span style={{ background: '#FEF3C7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>P3 ⏳ Pending</span>
                            <span style={{ background: '#FEF3C7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>P4 ⏳ Pending</span>
                        </div>
                    </motion.div>
                )}

                <AIInvoiceUpload onParsed={f => setForm(p => ({ ...p, ...(f.invoiceId ? { invoiceId: f.invoiceId } : {}), ...(f.amount ? { amount: f.amount } : {}), ...(f.description ? { description: f.description } : {}), ...(f.issueDate ? { issueDate: f.issueDate } : {}), ...(f.dueDate ? { dueDate: f.dueDate } : {}) }))} />
                <form onSubmit={async e => { e.preventDefault(); if (overCap) return; setSaving(true); try { await onCreate({ invoiceId: form.invoiceId, buyerParty: form.buyerParty, amount: parseFloat(form.amount), description: form.description, paymentTermDays: parseInt(form.paymentTermDays), issueDate: form.issueDate, dueDate: form.dueDate }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Invoice ID *</label><input style={inputStyle} value={form.invoiceId} onChange={set('invoiceId')} required /></div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Amount ($) *</label>
                            <input style={{ ...inputStyle, borderColor: overCap ? '#f87171' : C.border }} type="number" min="1" value={form.amount} onChange={set('amount')} placeholder="100000" required />
                            {overCap && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3, fontWeight: 700 }}>⚠️ Exceeds your {fmt$(cap)} provisional cap</div>}
                        </div>
                        <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Description *</label><input style={inputStyle} value={form.description} onChange={set('description')} placeholder="10,000 steel bolts" required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Issue Date *</label><input style={inputStyle} type="date" value={form.issueDate} onChange={set('issueDate')} required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Due Date *</label><input style={inputStyle} type="date" value={form.dueDate} onChange={set('dueDate')} required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Payment Terms (days)</label><input style={inputStyle} type="number" value={form.paymentTermDays} onChange={set('paymentTermDays')} /></div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Buyer Party ID</label>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input style={{ ...inputStyle, flex: 1 }} value={form.buyerParty} onChange={e => { set('buyerParty')(e); setBuyerScore(null); }} />
                                <Btn small color={C.gold} variant="outline" onClick={() => lookupBuyer(form.buyerParty)} disabled={buyerLookupLoading || !form.buyerParty.trim()}>
                                    {buyerLookupLoading ? '⏳' : '🔍'}
                                </Btn>
                            </div>
                        </div>
                    </div>
                    {buyerScore && (() => {
                        const bTierCfg = TIER_CFG[buyerScore.tier] ?? TIER_CFG.PROVISIONAL;
                        const isHighRisk = buyerScore.tier === 'UNRATED';
                        return (
                            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                                style={{ background: isHighRisk ? '#FEE2E2' : bTierCfg.bg, border: `1.5px solid ${isHighRisk ? '#ef4444' : bTierCfg.color}44`, borderRadius: 12, padding: '12px 14px', marginTop: 10 }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontWeight: 800, fontSize: 13, color: isHighRisk ? '#991b1b' : bTierCfg.color }}>
                                        {bTierCfg.icon} Buyer: {buyerScore.tier}
                                        {buyerScore.certified && !isHighRisk && <span style={{ marginLeft: 6, fontSize: 11 }}>✔ Certified</span>}
                                    </span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: isHighRisk ? '#991b1b' : bTierCfg.color }}>
                                        {buyerScore.totalScore}/{buyerScore.maxPossibleScore}
                                    </span>
                                </div>
                                {isHighRisk && <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600, marginBottom: 6 }}>⚠️ UNRATED buyer — banks will see HIGH RISK. Auction may attract fewer bids.</div>}
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {[
                                        { label: 'P1', status: buyerScore.proof1_status },
                                        { label: 'P2', status: buyerScore.proof2_status },
                                        { label: 'P3', status: buyerScore.proof3_status },
                                        { label: 'P4', status: buyerScore.proof4_status },
                                    ].map(p => (
                                        <span key={p.label} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: p.status === 'PASS' ? '#D1FAE5' : p.status === 'FAIL' ? '#FEE2E2' : '#F3F4F6', color: p.status === 'PASS' ? '#065f46' : p.status === 'FAIL' ? '#991b1b' : '#6b7280', border: p.status === 'PENDING' ? '1px dashed #d1d5db' : 'none' }}>
                                            {p.label} {p.status === 'PASS' ? '✅' : p.status === 'FAIL' ? '❌' : '—'}
                                        </span>
                                    ))}
                                </div>
                                {buyerScore.reason && <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 6 }}>{buyerScore.reason}</div>}
                            </motion.div>
                        );
                    })()}
                    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                        <Btn color={C.muted} variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn type="submit" disabled={saving || overCap} style={{ flex: 2, background: overCap ? 'var(--c-border)' : 'var(--c-gradient)' }}>
                            {saving ? 'Creating…' : overCap ? `Cap: ${fmt$(cap)} (Provisional)` : 'Create Invoice →'}
                        </Btn>
                    </div>
                </form>
            </motion.div>
        </motion.div>
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
    const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: C.glass, color: C.text };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'var(--c-modal-bg)', borderRadius: 24, padding: 28, maxWidth: 440, width: '90%', boxShadow: 'var(--c-shadow)', border: `1px solid ${C.border}` }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, color: C.text }}>Launch Auction</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}>✕</button>
                </div>
                <div style={{ background: 'rgba(79,70,229,0.06)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 13 }}>
                    <div style={{ fontWeight: 800, color: C.text }}>Invoice #{invoice.invoiceId}</div>
                    <div style={{ color: C.muted }}>{invoice.description} · {fmt$(invoice.amount)} · Due {invoice.dueDate}</div>
                </div>
                <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onStart({ auctionDurationDays: durationDays, auctionDurationSecs: durationDays * 86400, startRate, reserveRate, eligibleBanks: [] }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Duration: <strong style={{ color: C.primary }}>{durationDays} days</strong> · Closes {endDate}</label>
                        <input type="range" min={1} max={maxDays} value={durationDays} onChange={e => setDurationDays(parseInt(e.target.value))} style={{ width: '100%', accentColor: C.primary }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginTop: 2 }}>
                            <span>1 day</span><span>{maxDays} days (max)</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Opening Rate (%)</label>
                            <input type="number" step="0.1" value={startRate} onChange={e => setStartRate(parseFloat(e.target.value))} style={inputStyle} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Reserve Rate (%)</label>
                            <input type="number" step="0.1" value={reserveRate} onChange={e => setReserveRate(parseFloat(e.target.value))} style={inputStyle} />
                        </div>
                    </div>
                    <div style={{ background: 'rgba(79,70,229,0.06)', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: C.primary }}>
                        ℹ️ <strong>Sealed-bid auction:</strong> Institutions bid privately. The lowest rate wins at close. Bidding window closes on <strong>{endDate}</strong>.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <Btn color={C.muted} variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn type="submit" disabled={saving} style={{ flex: 2, background: 'var(--c-gradient)' }}>
                            {saving ? 'Launching…' : 'Launch Auction →'}
                        </Btn>
                    </div>
                </form>
            </motion.div>
        </motion.div>
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
        ? daysLeft > 0 ? `${daysLeft}d ${hoursLeft}h left` : `${hoursLeft}h left`
        : `${Math.floor((auction.auctionDurationSecs ?? 86400) / 86400)}d total`;
    const endDateStr = endTime ? endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const totalSecs = auction.auctionDurationSecs ?? 86400;
    const elapsed = endTime ? Math.max(0, totalSecs - (endTime.getTime() - now) / 1000) : 0;
    const progress = Math.min(1, elapsed / totalSecs);

    return (
        <Card style={{ border: `2px solid ${C.primary}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Invoice #{auction.invoiceId}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{auction.description}</div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Face value: {fmt$(auction.amount)} · Due {auction.dueDate}</div>
                </div>
                <StatusPill status={auction.status} />
            </div>

            <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 6 }}>
                    <span>Auction started</span>
                    <span>Closes {endDateStr}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(79,70,229,0.12)', overflow: 'hidden' }}>
                    <motion.div
                        style={{ height: '100%', borderRadius: 999, background: C.gradient, width: `${progress * 100}%` }}
                        initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                <Stat label="Best Rate" value={auction.currentBestRate != null ? `${auction.currentBestRate.toFixed(1)}%` : '—'} color={C.primary} />
                <Stat label="Bids Received" value={auction.bidCount ?? 0} color="#7c3aed" />
                <Stat label="Time Left" value={<span style={{ fontSize: 16 }}>{timeDisplay}</span>} color={C.gold} />
            </div>

            <div style={{ background: 'rgba(79,70,229,0.06)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: C.primary, marginBottom: 16 }}>
                🔒 Bids are sealed — you see only the best rate and bid count. Winner is revealed at close.
            </div>

            {(auction.bidCount ?? 0) > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>Verified Bidders:</div>
                    {Array.from({ length: auction.bidCount ?? 0 }, (_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#D1FAE5', borderRadius: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12 }}>🏦</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#065f46' }}>Bank {i + 1}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#065f46', background: '#A7F3D0', padding: '2px 8px', borderRadius: 999 }}>CERTIFIED ✓</span>
                            <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 'auto' }}>Bid sealed</span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
                <Btn color={C.muted} variant="outline" small onClick={onCancel}>Cancel Auction</Btn>
                <Btn style={{ flex: 1, background: 'var(--c-gradient)' }} onClick={onClose}>
                    Close &amp; Settle Best Bid
                </Btn>
            </div>
        </Card>
    );
};

// ─── Trust Score Panel ──────────────────────────────────────────────────────

const TIER_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    PLATINUM:    { label: 'Platinum',    color: '#374151', bg: '#E5E7EB', icon: '💎' },
    GOLD:        { label: 'Gold',        color: '#92400e', bg: '#FEF3C7', icon: '🥇' },
    SILVER:      { label: 'Silver',      color: '#374151', bg: '#F3F4F6', icon: '🥈' },
    PROVISIONAL: { label: 'Provisional', color: '#1e40af', bg: '#DBEAFE', icon: '🔄' },
    UNRATED:     { label: 'Unrated',     color: '#6b7280', bg: '#F9FAFB', icon: '❓' },
};

const ProofRow: React.FC<{ label: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, status, points }) => {
    const cfg = status === 'PASS' ? { icon: '✅', color: '#065f46', bg: '#D1FAE5' } : status === 'FAIL' ? { icon: '❌', color: '#991b1b', bg: '#FEE2E2' } : { icon: '⏳', color: '#92400e', bg: '#FEF3C7' };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: cfg.bg, borderRadius: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>{cfg.icon}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: cfg.color }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>{points} pts</span>
        </div>
    );
};

const BuyerProofRow: React.FC<{ label: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, status, points }) => {
    const cfg = status === 'PASS'
        ? { icon: '✅', color: '#065f46', bg: '#D1FAE5', border: 'none' as const }
        : status === 'FAIL'
        ? { icon: '❌', color: '#991b1b', bg: '#FEE2E2', border: 'none' as const }
        : { icon: '⬜', color: '#6b7280', bg: '#F3F4F6', border: '2px dashed #d1d5db' as const };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: cfg.bg, border: cfg.border, borderRadius: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>{cfg.icon}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: cfg.color }}>{label}</span>
            {status === 'PENDING'
                ? <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', fontStyle: 'italic' }}>Pending</span>
                : <span style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>{points} pts</span>
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
        <GlassCard style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 22 }}>🏭</span>
                        <span style={{ fontWeight: 900, fontSize: 18, color: C.text }}>{name}</span>
                        {sector && (
                            <span style={{ fontSize: 11, background: 'rgba(79,70,229,0.10)', color: C.primary, padding: '2px 9px', borderRadius: 999, fontWeight: 700 }}>{sector}</span>
                        )}
                    </div>
                    {trustScore && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 800, padding: '3px 10px', background: tier!.bg, color: tier!.color, borderRadius: 999 }}>
                                {tier!.icon} {tier!.label}
                            </span>
                            {trustScore.certified && <span style={{ fontSize: 11, background: '#D1FAE5', color: '#065f46', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>✔ Certified</span>}
                            {trustScore.invoiceValueCap != null && <span style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>Cap: ${trustScore.invoiceValueCap.toLocaleString()}</span>}
                        </div>
                    )}
                    {!trustScore && !loadingTrust && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>No trust score yet</div>}
                    {loadingTrust && !trustScore && (
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                            <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>🔐 Computing trust score…</motion.span>
                        </div>
                    )}
                </div>

                {trustScore && (
                    <div style={{ textAlign: 'right', minWidth: 120 }}>
                        <div style={{ fontSize: 32, fontWeight: 900, color: C.primary, lineHeight: 1 }}>
                            {trustScore.totalScore}
                            <span style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>/{trustScore.maxPossibleScore}</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>ZK Trust Score</div>
                        <div style={{ width: 120, height: 6, borderRadius: 999, background: 'rgba(79,70,229,0.12)', overflow: 'hidden', marginLeft: 'auto' }}>
                            <motion.div
                                initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut' }}
                                style={{ height: '100%', borderRadius: 999, background: C.gradient }}
                            />
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{pct.toFixed(0)}%</div>
                    </div>
                )}
            </div>

            {trustScore && (
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button onClick={() => setShowProofs(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                            🔐 ZK Proof Breakdown <span style={{ fontSize: 10 }}>{showProofs ? '▲' : '▼'}</span>
                        </button>
                        <Btn small color={C.muted} variant="ghost" onClick={onRefresh} disabled={loadingTrust}>
                            {loadingTrust ? '⏳' : '🔄 Refresh'}
                        </Btn>
                    </div>
                    <AnimatePresence>
                        {showProofs && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden', marginTop: 10 }}>
                                {proofs.map(p => <ProofRow key={p.label} {...p} />)}
                                {trustScore.reason && <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginTop: 6 }}>{trustScore.reason}</div>}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {!trustScore && !loadingTrust && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                    <Btn small onClick={onRefresh} style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
                        🔐 Generate ZK Trust Score
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
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 40px' }}>
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} style={{ marginBottom: 20 }}>
                <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 24, color: C.text }}>
                    Invoice Management
                </h2>
                <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Submit invoices for financing. Receive early payment and improve cash flow.</p>
            </motion.div>

            {myProfile && (
                <CompanyIdentityCard
                    name={myProfile.displayName ?? ''}
                    sector={myProfile.sector ?? null}
                    trustScore={trustScore}
                    loadingTrust={loadingTrust}
                    onRefresh={refreshTrustScore}
                />
            )}

            <motion.div variants={stagger} initial="hidden" animate="visible" style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Pending Invoices" value={invoices.length} color={C.primary} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Active Auction" value={openAuctions.length} color={openAuctions.length > 0 ? C.gold : C.muted} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Financed" value={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} color={C.green} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Paid Out" value={paidInvoices.length} color={C.muted} /></motion.div>
            </motion.div>

            <div style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${C.border}`, marginBottom: 24, flexWrap: 'wrap' }}>
                <Tab label="My Invoices" active={tab === 'invoices'} count={invoices.length} onClick={() => setTab('invoices')} accent={C.primary} />
                <Tab label="Live Auction" active={tab === 'auction'} count={openAuctions.length} onClick={() => setTab('auction')} accent={C.primary} />
                <Tab label="Financed" active={tab === 'financed'} count={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} onClick={() => setTab('financed')} accent={C.primary} />
                <Tab label="Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.primary} />
            </div>

            <AnimatePresence>
                {closeResult && (
                    <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                        style={{ background: closeResult.noWinner ? '#FFF3CD' : '#D1FAE5', border: `1px solid ${closeResult.noWinner ? '#FFC107' : C.green}`, borderRadius: 12, padding: '14px 18px', marginBottom: 20, position: 'relative' }}
                    >
                        {closeResult.noWinner
                            ? <span>⚠️ <strong>Auction closed with no bids.</strong> Invoice returned to your list.</span>
                            : <span>✅ <strong>Auction settled!</strong> {closeResult.winningInstitutionDisplayName ?? 'An institution'} won at <strong>{closeResult.winningRate?.toFixed(2)}%</strong> — you received <strong>{fmt$(closeResult.purchaseAmount)}</strong> early payment.</span>
                        }
                        <button onClick={() => setCloseResult(null)} style={{ position: 'absolute', right: 14, top: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
                {tab === 'invoices' && (
                    <motion.div key="invoices" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h4 style={{ margin: 0, fontWeight: 800, color: C.text }}>My Invoices</h4>
                            <Btn onClick={() => setShowCreate(true)} style={{ background: 'var(--c-gradient)' }}>+ New Invoice</Btn>
                        </div>
                        {invoices.length === 0 ? (
                            <EmptyState icon="📋" message="No invoices yet. Create your first invoice to start the financing process." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {invoices.map(inv => (
                                    <Card key={inv.contractId}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                    <span style={{ fontWeight: 800, color: C.text }}>#{inv.invoiceId}</span>
                                                    <StatusPill status={inv.status} />
                                                </div>
                                                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{inv.description}</div>
                                                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                                                    {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)} days left
                                                </div>
                                                <div style={{ marginTop: 6 }}>
                                                    <span style={{ fontSize: 11, background: 'rgba(79,70,229,0.10)', color: C.primary, padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                                                        {daysUntil(inv.dueDate) > 60 ? 'Low urgency' : daysUntil(inv.dueDate) > 30 ? 'Medium urgency' : 'Urgent — launch soon'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                                                <Btn small color={C.muted} variant="outline" onClick={() => deleteInvoice(inv.contractId)}>Delete</Btn>
                                                {!hasActive && <Btn small style={{ background: 'var(--c-gradient)' }} onClick={() => setStartAuctionInvoice(inv)}>🚀 Launch Auction</Btn>}
                                                {hasActive && <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', paddingTop: 4 }}>Auction active</span>}
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {tab === 'auction' && (
                    <motion.div key="auction" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Live Auction</h4>
                        {!hasActive ? (
                            <EmptyState icon="⚡" message="No active auction. Start one from the My Invoices tab." />
                        ) : (
                            <AuctionStatusCard
                                auction={activeAuction}
                                onClose={async () => { const r = await closeAuction(activeAuction.contractId); if (r) setCloseResult(r); }}
                                onCancel={() => cancelAuction(activeAuction.contractId)}
                            />
                        )}
                    </motion.div>
                )}

                {tab === 'financed' && (
                    <motion.div key="financed" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Financed Invoices</h4>
                        {financedInvoices.filter(i => i.paymentStatus !== 'PAID').length === 0 ? (
                            <EmptyState icon="🏦" message="No financed invoices yet." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {financedInvoices.filter(i => i.paymentStatus !== 'PAID').map(inv => (
                                    <GlassCard key={inv.contractId}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontWeight: 800, color: C.text, marginBottom: 4 }}>#{inv.invoiceId}</div>
                                                <div style={{ fontSize: 14, color: C.text }}>{inv.description}</div>
                                                <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Face value: {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)} days</div>
                                            </div>
                                            <Btn color={C.green} onClick={() => payFinancedInvoice(inv.contractId)}>Pay Invoice</Btn>
                                        </div>
                                    </GlassCard>
                                ))}
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {tab === 'archive' && (
                    <motion.div key="archive" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Settled Invoices</h4>
                        {paidInvoices.length === 0 ? (
                            <EmptyState icon="📦" message="No paid invoices yet." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {paidInvoices.map(inv => (
                                    <GlassCard key={inv.contractId} style={{ padding: '14px 18px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                            <span style={{ color: C.text }}>#{inv.invoiceId} — {inv.description}</span>
                                            <span style={{ fontWeight: 800, color: C.green }}>{fmt$(inv.amount)}</span>
                                        </div>
                                        <EvmSettlementBadge bridgeState={(inv as any).bridgeState} txHash={(inv as any).paymentTxHash} />
                                    </GlassCard>
                                ))}
                            </motion.div>
                        )}
                    </motion.div>
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
        <Card style={{ border: highRiskBuyer ? `2px solid #ef4444` : hasBid ? `2px solid ${C.gold}` : `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, color: C.text }}>#{auction.invoiceId}</span>
                        {hasBid && (
                            <motion.span
                                initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400 }}
                                style={{ background: isWinning ? '#D1FAE5' : '#FFF3CD', color: isWinning ? C.green : '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800 }}
                            >
                                {isWinning ? '🏆 WINNING BID' : '📋 BID PLACED'}
                            </motion.span>
                        )}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>{auction.description}</div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
                        <span>💰 {fmt$(auction.amount)}</span>
                        <span>📅 Due {auction.dueDate}</span>
                        {daysLeft != null && <span>⏱ {daysLeft > 0 ? `Closes ${endDateStr}` : 'Closing soon'}</span>}
                    </div>
                </div>
                <div style={{ flexShrink: 0, marginLeft: 16 }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 4 }}>
                        {tierCfg && (
                            <div style={{ padding: '5px 8px', borderRadius: 10, background: tierCfg.bg, border: `1px solid ${tierCfg.color}22`, textAlign: 'center' }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, marginBottom: 1 }}>SUPPLIER</div>
                                <div style={{ fontSize: 13 }}>{tierCfg.icon}</div>
                                <div style={{ fontSize: 9, fontWeight: 900, color: tierCfg.color, whiteSpace: 'nowrap' }}>{tierCfg.label.toUpperCase()}</div>
                                {supplierCertified && <div style={{ fontSize: 8, color: tierCfg.color, opacity: 0.85, fontWeight: 700 }}>✓</div>}
                            </div>
                        )}
                        {buyerTierCfg && (
                            <div style={{ padding: '5px 8px', borderRadius: 10, background: buyerTierCfg.bg, border: highRiskBuyer ? `1px solid #ef4444` : `1px solid ${buyerTierCfg.color}22`, textAlign: 'center' }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, marginBottom: 1 }}>BUYER</div>
                                <div style={{ fontSize: 13 }}>{buyerTierCfg.icon}</div>
                                <div style={{ fontSize: 9, fontWeight: 900, color: highRiskBuyer ? '#ef4444' : buyerTierCfg.color, whiteSpace: 'nowrap' }}>{buyerTierCfg.label.toUpperCase()}</div>
                                {highRiskBuyer && <div style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>⚠</div>}
                                {buyerCertified && !highRiskBuyer && <div style={{ fontSize: 8, color: buyerTierCfg.color, opacity: 0.85, fontWeight: 700 }}>✓</div>}
                            </div>
                        )}
                        {!tierCfg && !buyerTierCfg && (
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>—</span>
                            </div>
                        )}
                    </div>
                    {combinedRisk && (
                        <div style={{ fontSize: 9, fontWeight: 800, padding: '3px 7px', borderRadius: 999, textAlign: 'center', background: combinedRisk === 'LOW RISK' ? '#D1FAE5' : combinedRisk === 'MEDIUM RISK' ? '#FEF3C7' : combinedRisk === 'ELEVATED RISK' ? '#FED7AA' : '#FEE2E2', color: combinedRisk === 'LOW RISK' ? '#065f46' : combinedRisk === 'MEDIUM RISK' ? '#92400e' : combinedRisk === 'ELEVATED RISK' ? '#7c2d12' : '#991b1b' }}>
                            {combinedRisk}
                        </div>
                    )}
                    {bestRate != null && (
                        <div style={{ marginTop: 6, textAlign: 'right' }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: C.primary }}>{bestRate.toFixed(2)}%</div>
                            <div style={{ fontSize: 10, color: C.muted }}>best rate</div>
                        </div>
                    )}
                </div>
            </div>

            {hasBid && bidStatus?.myRate != null && (
                <div style={{ background: isWinning ? '#D1FAE5' : 'rgba(79,70,229,0.06)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: isWinning ? C.green : C.primary }}>
                    Your bid: <strong>{bidStatus.myRate.toFixed(2)}%</strong>
                    {isWinning ? ' — 🏆 You have the best offer!' : bestRate != null ? ` — Best is ${bestRate.toFixed(2)}%` : ''}
                    {bidStatus?.averageBid != null && (
                        <span style={{ marginLeft: 8, color: C.gold }}>· Avg: {(bidStatus.averageBid as number).toFixed(2)}%</span>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>
                        {hasBid ? 'Update your rate (%)' : 'Your offered rate (%)'}
                    </label>
                    <input
                        type="number" step="0.01" min={auction.reserveRate} max={auction.startRate}
                        value={rate} onChange={e => setRate(e.target.value)}
                        placeholder={`${auction.reserveRate.toFixed(1)} – ${auction.startRate.toFixed(1)}`}
                        style={{ width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: C.glass, color: C.text }}
                    />
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Lower rate = better chance of winning. Bids are sealed.
                        {(auction.averageBid != null) && (
                            <span style={{ marginLeft: 8, fontWeight: 700, color: C.gold }}>
                                Market avg: {(auction.averageBid as number).toFixed(2)}%
                            </span>
                        )}
                    </div>
                </div>
                <Btn
                    color={C.gold}
                    disabled={bidding || !rate || bidBlocked}
                    onClick={handleBid}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0, background: bidding || bidBlocked ? 'var(--c-border)' : C.instGrad, cursor: bidBlocked ? 'not-allowed' : 'pointer' }}
                >
                    {bidBlocked ? '🔒 Not Certified' : bidding ? '…' : hasBid ? 'Update Bid' : 'Place Bid →'}
                </Btn>
            </div>
            {bidBlocked && bidBlockedReason && (
                <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600, marginTop: 4 }}>{bidBlockedReason}</div>
            )}

            {buyerTierCfg && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                    <button onClick={() => setShowBuyerProofs(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                        👤 Buyer ZK Trust Breakdown <span style={{ fontSize: 10 }}>{showBuyerProofs ? '▲' : '▼'}</span>
                    </button>
                    <AnimatePresence>
                        {showBuyerProofs && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden', marginTop: 8 }}>
                                {buyerTrustScore != null && buyerMaxScore != null && (
                                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                                        Buyer Score: <strong style={{ color: C.text }}>{buyerTrustScore}/{buyerMaxScore}</strong>
                                        {buyerTier && <span style={{ marginLeft: 8, fontWeight: 700, color: buyerTierCfg.color }}>{buyerTierCfg.icon} {buyerTier}</span>}
                                    </div>
                                )}
                                <BuyerProofRow label="P1 — Payment History (≥90%)" status={buyerProof1Status} points={3} />
                                <BuyerProofRow label="P2 — Invoice Confirm Rate (≥80%)" status={buyerProof2Status} points={2} />
                                <BuyerProofRow label="P3 — Dispute Record (≤5%)" status={buyerProof3Status} points={2} />
                                <BuyerProofRow label="P4 — Payment Timeliness (≥85%)" status={buyerProof4Status} points={3} />
                                {buyerReason && <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 6 }}>{buyerReason}</div>}
                                {highRiskBuyer && <div style={{ fontSize: 12, color: '#991b1b', fontWeight: 700, marginTop: 6, padding: '6px 10px', background: '#FEE2E2', borderRadius: 8 }}>⚠️ UNRATED buyer — no verified payment history available.</div>}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </Card>
    );
};

// ─── Bank Certification Banner ──────────────────────────────────────────────

const BANK_TIER_CFG: Record<string, { label: string; color: string; bg: string; icon: string; border: string }> = {
    CERTIFIED:      { label: 'Certified',      color: '#065f46', bg: '#D1FAE5', icon: '✓', border: '#10b981' },
    PROBATIONARY:   { label: 'Probationary',   color: '#92400e', bg: '#FEF3C7', icon: '⏳', border: '#f59e0b' },
    SUSPENDED:      { label: 'Suspended',      color: '#991b1b', bg: '#FEE2E2', icon: '✗', border: '#ef4444' },
    RATE_VIOLATION: { label: 'Rate Violation',  color: '#7c2d12', bg: '#FED7AA', icon: '⚠', border: '#ea580c' },
};

const BankProofRow: React.FC<{ label: string; detail: string; status: 'PASS' | 'FAIL' | 'PENDING'; points: number }> = ({ label, detail, status, points }) => {
    const cfg = status === 'PASS' ? { icon: '✅', color: '#065f46', bg: '#D1FAE5' } : status === 'FAIL' ? { icon: '❌', color: '#991b1b', bg: '#FEE2E2' } : { icon: '⏳', color: '#92400e', bg: '#FEF3C7' };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: cfg.bg, borderRadius: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>{cfg.icon}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{label}</div>
                <div style={{ fontSize: 11, color: cfg.color, opacity: 0.8 }}>{detail}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 800, color: cfg.color }}>{points}/1</span>
        </div>
    );
};

const BankCertBanner: React.FC<{ bs: BankTrustScoreData; loading: boolean; onRefresh: () => void }> = ({ bs, loading, onRefresh }) => {
    const tier = BANK_TIER_CFG[bs.tier] ?? BANK_TIER_CFG.SUSPENDED;
    const [expanded, setExpanded] = useState(false);

    return (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${tier.border}`, background: `${tier.bg}cc` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20, fontWeight: 900, color: tier.color }}>{tier.icon}</span>
                    <span style={{ fontWeight: 900, fontSize: 15, color: tier.color }}>{tier.label.toUpperCase()}</span>
                    <span style={{ fontSize: 13, color: tier.color, fontWeight: 700 }}>· Score {bs.totalScore}/3</span>
                    {bs.canBid
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>· You can bid freely</span>
                        : <span style={{ fontSize: 12, fontWeight: 700, color: '#991b1b' }}>· Bidding disabled</span>
                    }
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Btn small color={tier.color} variant="ghost" onClick={() => setExpanded(v => !v)}>
                        {expanded ? '▲ Hide' : '▼ Details'}
                    </Btn>
                    <Btn small color={C.muted} variant="ghost" onClick={onRefresh} disabled={loading}>
                        {loading ? '⏳' : '🔄'}
                    </Btn>
                </div>
            </div>

            {!bs.canBid && bs.reason && (
                <div style={{ marginTop: 8, fontSize: 12, color: tier.color, fontWeight: 600 }}>Reason: {bs.reason}</div>
            )}

            <AnimatePresence>
                {expanded && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: 12 }}>
                        <BankProofRow label="X  Liquidity" detail={bs.proofX_status === 'PASS' ? 'Reserves cover ≥110% of offer' : 'Reserves insufficient'} status={bs.proofX_status} points={bs.proofX_points} />
                        <BankProofRow label="Y  Legitimacy" detail={bs.proofY_status === 'PASS' ? 'Node active ≥30 days' : bs.proofY_status === 'PENDING' ? 'Node not yet 30 days old' : 'Node age check failed'} status={bs.proofY_status} points={bs.proofY_points} />
                        <BankProofRow label="Z  Rate Range" detail={bs.proofZ_status === 'PASS' ? 'Rate within network benchmark' : 'Rate exceeds network average by >20%'} status={bs.proofZ_status} points={bs.proofZ_points} />
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                            Last verified: {bs.timestamp ? new Date(bs.timestamp).toLocaleString() : '—'}
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
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 40px' }}>
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} style={{ marginBottom: 28 }}>
                <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 24, color: C.text }}>
                    Financing Opportunities
                </h2>
                <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Browse live auctions, submit confidential bids, earn yield at maturity.</p>
            </motion.div>

            {bankScore && <BankCertBanner bs={bankScore} loading={loadingBankScore} onRefresh={refreshBankScore} />}
            {!bankScore && !loadingBankScore && (
                <GlassCard style={{ marginBottom: 20, textAlign: 'center', padding: '16px 20px' }}>
                    <Btn color={C.gold} onClick={refreshBankScore} disabled={loadingBankScore} style={{ background: C.instGrad }}>
                        {loadingBankScore ? '⏳ Generating...' : '🏦 Generate Bank Certification'}
                    </Btn>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Required before you can place bids</div>
                </GlassCard>
            )}

            <motion.div variants={stagger} initial="hidden" animate="visible" style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Open Auctions" value={openAuctions.length} color={C.primary} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="My Bids" value={Object.values(bidStatuses).filter(b => b.hasBid).length} color={C.gold} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Active Loans" value={activeLoans.length} color={C.green} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Settled" value={paidInvoices.length} color={C.muted} /></motion.div>
            </motion.div>

            <div style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${C.border}`, marginBottom: 24 }}>
                <Tab label="Discover" active={tab === 'discover'} count={openAuctions.length} onClick={() => setTab('discover')} accent={C.gold} />
                <Tab label="My Loans" active={tab === 'loans'} count={activeLoans.length} onClick={() => setTab('loans')} accent={C.gold} />
                <Tab label="Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.gold} />
            </div>

            <AnimatePresence mode="wait">
                {tab === 'discover' && (
                    <motion.div key="discover" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Open Auctions</h4>
                        {openAuctions.length === 0 ? (
                            <EmptyState icon="🔍" message="No open auctions right now. Check back soon." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
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
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {tab === 'loans' && (
                    <motion.div key="loans" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>My Loans</h4>
                        {activeLoans.length === 0 ? (
                            <EmptyState icon="💼" message="No active loans. Win an auction to start earning yield." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {activeLoans.map(inv => {
                                    const bo = bankOwnerships.find(b => b.invoiceId === inv.invoiceId);
                                    return (
                                        <GlassCard key={inv.contractId}>
                                            <div style={{ fontWeight: 800, color: C.text, marginBottom: 4 }}>#{inv.invoiceId}</div>
                                            <div style={{ fontSize: 14, color: C.text, marginBottom: 10 }}>{inv.description}</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 8 }}>
                                                <Stat label="Face Value" value={fmt$(inv.amount)} color={C.gold} />
                                                {bo && <Stat label="Purchase Rate" value={`${bo.purchaseRate.toFixed(2)}%`} color={C.primary} />}
                                                {bo && <Stat label="Paid" value={fmt$(bo.purchaseAmount)} color={C.green} />}
                                            </div>
                                            <div style={{ fontSize: 13, color: C.muted }}>Due {inv.dueDate} · {daysUntil(inv.dueDate)} days to maturity</div>
                                            {bo && <div style={{ fontSize: 12, color: C.green, fontWeight: 700, marginTop: 6 }}>Expected yield: {fmt$((bo.faceValue ?? inv.amount) - bo.purchaseAmount)} at maturity</div>}
                                        </GlassCard>
                                    );
                                })}
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {tab === 'archive' && (
                    <motion.div key="archive" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Settled Loans</h4>
                        {paidInvoices.length === 0 ? (
                            <EmptyState icon="📦" message="No settled loans yet." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {paidInvoices.map(inv => (
                                    <GlassCard key={inv.contractId} style={{ padding: '14px 18px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                            <span style={{ color: C.text }}>#{inv.invoiceId} — {inv.description}</span>
                                            <span style={{ fontWeight: 800, color: C.green }}>{fmt$(inv.amount)}</span>
                                        </div>
                                        <EvmSettlementBadge bridgeState={(inv as any).bridgeState} txHash={(inv as any).paymentTxHash} />
                                    </GlassCard>
                                ))}
                            </motion.div>
                        )}
                    </motion.div>
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
                    style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--c-border)', borderTopColor: 'var(--c-primary)' }}
                />
            </div>
        );
    }

    if (user === null) return null;

    if (!myProfile) return <ProfileSetupModal onSave={saveMyProfile} />;

    const isCompany = myProfile.type === 'COMPANY';

    return (
        <div style={{ minHeight: '100vh', paddingTop: 24 }}>
            {isCompany ? <CompanyDashboard /> : <InstitutionDashboard />}
        </div>
    );
};

export default DashboardView;
