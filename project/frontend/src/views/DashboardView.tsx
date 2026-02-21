// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useInvoiceFinance } from '../stores/invoiceFinanceStore';
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

// ─── Design tokens ─────────────────────────────────────────────────────────

const C = {
    primary:   '#FF4B6E',
    dark:      '#D93058',
    gold:      '#C9956C',
    bg:        '#FFF0F5',
    text:      '#2D0A1A',
    muted:     '#9E6B7D',
    glass:     'rgba(255,255,255,0.75)',
    border:    'rgba(255,75,110,0.18)',
    shadow:    '0 8px 32px rgba(255,75,110,0.18)',
    green:     '#10b981',
    amber:     '#f59e0b',
    gradient:  'linear-gradient(135deg, #FF4B6E 0%, #C9956C 100%)',
    instGrad:  'linear-gradient(135deg, #C9956C 0%, #E8B48A 100%)',
};

// ─── Animation variants ─────────────────────────────────────────────────────

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = {
    hidden: { opacity: 0, y: 24, scale: 0.97 },
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

const GlassCard: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }> = ({ children, style, onClick }) => (
    <motion.div
        variants={fadeUp}
        onClick={onClick}
        style={{
            background: C.glass,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: `1px solid ${C.border}`,
            borderRadius: 18,
            padding: 20,
            marginBottom: 14,
            boxShadow: C.shadow,
            ...style,
        }}
    >
        {children}
    </motion.div>
);

const TiltCard: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ x: 0, y: 0 });

    return (
        <motion.div
            ref={ref}
            variants={fadeUp}
            onMouseMove={(e) => {
                const rect = ref.current!.getBoundingClientRect();
                const cx = (e.clientX - rect.left) / rect.width - 0.5;
                const cy = (e.clientY - rect.top) / rect.height - 0.5;
                setTilt({ x: cy * -10, y: cx * 10 });
            }}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}
            animate={{ rotateX: tilt.x, rotateY: tilt.y }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, mass: 0.5 }}
            style={{
                transformStyle: 'preserve-3d',
                background: C.glass,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${C.border}`,
                borderRadius: 18,
                padding: 20,
                marginBottom: 14,
                boxShadow: C.shadow,
                ...style,
            }}
        >
            {children}
        </motion.div>
    );
};

const CupidBtn: React.FC<{
    onClick?: () => void;
    color?: string;
    variant?: 'solid' | 'outline' | 'ghost';
    small?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ onClick, color = C.primary, variant = 'solid', small, disabled, children, style }) => (
    <motion.button
        onClick={onClick}
        disabled={disabled}
        whileHover={{ scale: disabled ? 1 : 1.03 }}
        whileTap={{ scale: disabled ? 1 : 0.97 }}
        style={{
            padding: small ? '7px 14px' : '11px 20px',
            fontSize: small ? 12 : 14,
            fontWeight: 800,
            borderRadius: 10,
            border: variant === 'outline' ? `2px solid ${color}` : 'none',
            background: disabled ? '#E8D0D8' : variant === 'solid' ? color : 'transparent',
            color: disabled ? '#C9956C' : variant === 'solid' ? '#fff' : color,
            cursor: disabled ? 'default' : 'pointer',
            boxShadow: (!disabled && variant === 'solid') ? `0 4px 14px ${color}40` : 'none',
            ...style,
        }}
    >
        {children}
    </motion.button>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color = C.primary }) => (
    <div style={{
        background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)',
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
            padding: '10px 18px', fontWeight: 800, fontSize: 14, border: 'none',
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
                marginLeft: 6, background: active ? accent : '#E8D0D8',
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
            animate={{ y: [0, -8, 0], rotate: [-5, 5, -5] }}
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
        CONFIRMED:            { bg: '#FFE8EF', fg: C.primary },
        PENDING_CONFIRMATION: { bg: '#FFF3CD', fg: '#92400e' },
        IN_AUCTION:           { bg: '#EDE9FE', fg: '#4c1d95' },
        FINANCED:             { bg: '#D1FAE5', fg: '#065f46' },
        PAID:                 { bg: '#D1FAE5', fg: '#065f46' },
        OPEN:                 { bg: '#FFE8EF', fg: C.primary },
        CLOSED:               { bg: '#F3F4F6', fg: '#6b7280' },
    };
    const c = map[status] || { bg: '#F3F4F6', fg: '#374151' };
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
        CONFIRMING: { label: 'Confirming on EVM',  bg: '#EDE9FE', fg: '#4c1d95', dot: '#7c3aed' },
        CONFIRMED:  { label: 'EVM Confirmed',      bg: '#D1FAE5', fg: '#065f46', dot: '#10b981' },
    };
    const c = cfg[bridgeState] ?? { label: bridgeState, bg: '#F3F4F6', fg: '#374151', dot: '#6b7280' };
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
                toast.displaySuccess('Fields partially filled. Add VITE_ANTHROPIC_API_KEY for full AI parsing.');
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
        <div style={{ border: `2px dashed ${C.primary}`, borderRadius: 12, padding: 14, background: '#FFF0F5', textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 4 }}>🤖 AI Invoice Parser</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Upload an invoice image/PDF to auto-fill fields</div>
            <label style={{ cursor: loading ? 'wait' : 'pointer' }}>
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
                <motion.span
                    whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                    style={{ display: 'inline-block', padding: '6px 18px', background: loading ? '#D4A0AD' : C.primary, color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
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
    const stored = localStorage.getItem('cupid-role') as 'COMPANY' | 'INSTITUTION' | null;
    const [form, setForm] = useState<UpdateProfileRequest>({ displayName: '', type: stored ?? 'COMPANY', sector: 'Technology' });
    const [saving, setSaving] = useState(false);
    const set = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [key]: e.target.value }));
    const setNum = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }));

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(45,10,26,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div
                initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 36, maxWidth: 520, width: '90%', boxShadow: '0 24px 60px rgba(255,75,110,0.25)', maxHeight: '90vh', overflowY: 'auto' }}
            >
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <motion.div animate={{ rotate: [-6, 6, -6] }} transition={{ duration: 2.5, repeat: Infinity }} style={{ fontSize: 44 }}>💘</motion.div>
                    <h2 style={{ margin: '8px 0 4px', fontWeight: 900, fontSize: 22, background: C.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Welcome! Set Up Your Profile</h2>
                    <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Tell us about yourself to get started</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                            style={{ flex: 1, padding: '12px 0', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', border: '2px solid', borderColor: form.type === t ? (t === 'COMPANY' ? C.primary : C.gold) : C.border, background: form.type === t ? (t === 'COMPANY' ? '#FFE8EF' : '#FFF5EE') : '#F9FAFB', color: form.type === t ? (t === 'COMPANY' ? C.primary : C.gold) : C.muted }}
                        >
                            {t === 'COMPANY' ? '🏭 Company' : '🏦 Institution'}
                        </button>
                    ))}
                </div>
                <form onSubmit={async (e) => { e.preventDefault(); if (!form.displayName?.trim()) return; setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>{form.type === 'COMPANY' ? 'Company' : 'Institution'} Name *</label>
                            <input value={form.displayName} onChange={set('displayName')} placeholder={form.type === 'COMPANY' ? 'Acme Corp' : 'First Capital Bank'} required style={{ width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>Sector</label>
                            <select value={form.sector ?? ''} onChange={set('sector')} style={{ width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none' }}>
                                {SECTORS.map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>Founded Year</label>
                            <input type="number" placeholder="2010" value={form.foundedYear ?? ''} onChange={setNum('foundedYear')} style={{ width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                        {form.type === 'COMPANY' && <>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>Annual Revenue ($)</label>
                                <input type="number" placeholder="5000000" value={form.annualRevenue ?? ''} onChange={setNum('annualRevenue')} style={{ width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: C.text, display: 'block', marginBottom: 4 }}>Employees</label>
                                <input type="number" placeholder="50" value={form.employeeCount ?? ''} onChange={setNum('employeeCount')} style={{ width: '100%', padding: '10px 14px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                        </>}
                    </div>
                    <motion.button type="submit" disabled={saving || !form.displayName?.trim()} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        style={{ width: '100%', marginTop: 20, padding: '13px 0', background: saving || !form.displayName?.trim() ? '#E8D0D8' : C.gradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: saving ? 'wait' : 'pointer', boxShadow: `0 4px 18px ${C.primary}40` }}
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
    const today = new Date().toISOString().split('T')[0];
    const defaultDue = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];
    const [form, setForm] = useState({ invoiceId: 'INV-' + Date.now().toString().slice(-6), buyerParty: 'buyer-party', amount: '', description: '', paymentTermDays: '90', issueDate: today, dueDate: defaultDue });
    const [saving, setSaving] = useState(false);
    const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
    const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: 'rgba(255,255,255,0.9)' };

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(45,10,26,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 28, maxWidth: 520, width: '90%', boxShadow: `0 20px 60px ${C.primary}30`, maxHeight: '92vh', overflowY: 'auto' }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, background: C.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>✨ Create Invoice</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}>✕</button>
                </div>
                <AIInvoiceUpload onParsed={f => setForm(p => ({ ...p, ...(f.invoiceId ? { invoiceId: f.invoiceId } : {}), ...(f.amount ? { amount: f.amount } : {}), ...(f.description ? { description: f.description } : {}), ...(f.issueDate ? { issueDate: f.issueDate } : {}), ...(f.dueDate ? { dueDate: f.dueDate } : {}) }))} />
                <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onCreate({ invoiceId: form.invoiceId, buyerParty: form.buyerParty, amount: parseFloat(form.amount), description: form.description, paymentTermDays: parseInt(form.paymentTermDays), issueDate: form.issueDate, dueDate: form.dueDate }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Invoice ID *</label><input style={inputStyle} value={form.invoiceId} onChange={set('invoiceId')} required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Amount ($) *</label><input style={inputStyle} type="number" min="1" value={form.amount} onChange={set('amount')} placeholder="100000" required /></div>
                        <div style={{ gridColumn: '1/-1' }}><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Description *</label><input style={inputStyle} value={form.description} onChange={set('description')} placeholder="10,000 steel bolts" required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Issue Date *</label><input style={inputStyle} type="date" value={form.issueDate} onChange={set('issueDate')} required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Due Date *</label><input style={inputStyle} type="date" value={form.dueDate} onChange={set('dueDate')} required /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Payment Terms (days)</label><input style={inputStyle} type="number" value={form.paymentTermDays} onChange={set('paymentTermDays')} /></div>
                        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Buyer Party ID</label><input style={inputStyle} value={form.buyerParty} onChange={set('buyerParty')} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                        <CupidBtn color={C.muted} variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</CupidBtn>
                        <CupidBtn disabled={saving} style={{ flex: 2, background: C.gradient }}>
                            {saving ? 'Creating…' : '💘 Make It Attractive'}
                        </CupidBtn>
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

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(45,10,26,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}
        >
            <motion.div initial={{ scale: 0.88, y: 32 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{ background: 'rgba(255,255,255,0.95)', borderRadius: 24, padding: 28, maxWidth: 440, width: '90%', boxShadow: `0 20px 60px ${C.primary}30` }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, background: C.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>⚡ Launch Auction</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}>✕</button>
                </div>
                <div style={{ background: 'rgba(255,75,110,0.06)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 13 }}>
                    <div style={{ fontWeight: 800, color: C.text }}>Invoice #{invoice.invoiceId}</div>
                    <div style={{ color: C.muted }}>{invoice.description} · {fmt$(invoice.amount)} · Due {invoice.dueDate}</div>
                </div>
                <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onStart({ auctionDurationDays: durationDays, auctionDurationSecs: durationDays * 86400, startRate, reserveRate, eligibleBanks: [] }); onClose(); } finally { setSaving(false); } }}>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Auction Duration: <strong style={{ color: C.primary }}>{durationDays} days</strong> · Closes {endDate}</label>
                        <input type="range" min={1} max={maxDays} value={durationDays} onChange={e => setDurationDays(parseInt(e.target.value))} style={{ width: '100%', accentColor: C.primary }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginTop: 2 }}>
                            <span>1 day</span><span>{maxDays} days (max)</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Opening Rate (%)</label>
                            <input type="number" step="0.1" value={startRate} onChange={e => setStartRate(parseFloat(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'block', marginBottom: 4 }}>Reserve Rate (%)</label>
                            <input type="number" step="0.1" value={reserveRate} onChange={e => setReserveRate(parseFloat(e.target.value))} style={{ width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                    </div>
                    <div style={{ background: '#FFF0F5', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: C.primary }}>
                        💘 <strong>Sealed-bid auction:</strong> Institutions bid privately. Lowest rate wins at close. The bidding window closes on <strong>{endDate}</strong>.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <CupidBtn color={C.muted} variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</CupidBtn>
                        <CupidBtn disabled={saving} style={{ flex: 2, background: C.gradient }}>{saving ? 'Launching…' : '💘 Launch & Attract Bids'}</CupidBtn>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
};

// ─── Auction Status Card (Company "Attraction" view) ────────────────────────

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
        <TiltCard style={{ border: `2px solid ${C.primary}`, background: 'linear-gradient(135deg, rgba(255,240,245,0.95), rgba(255,245,238,0.95))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Invoice #{auction.invoiceId}</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{auction.description}</div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Face value: {fmt$(auction.amount)} · Due {auction.dueDate}</div>
                </div>
                <StatusPill status={auction.status} />
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 6 }}>
                    <span>Auction started</span>
                    <span>Closes {endDateStr}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,75,110,0.15)', overflow: 'hidden' }}>
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

            <div style={{ background: '#FFF0F5', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: C.primary, marginBottom: 16 }}>
                🔒 Bids are sealed — you see only the best rate and bid count. Winner is revealed at close.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
                <CupidBtn color={C.muted} variant="outline" small onClick={onCancel}>Cancel Auction</CupidBtn>
                <CupidBtn style={{ flex: 1, background: C.gradient }} onClick={onClose}>
                    💘 Close &amp; Settle Best Bid
                </CupidBtn>
            </div>
        </TiltCard>
    );
};

// ─── Company "Attraction" Dashboard ────────────────────────────────────────

type CompanyTab = 'invoices' | 'auction' | 'financed' | 'archive';

const AttractionDashboard: React.FC = () => {
    const { invoices, auctions, financedInvoices, paidInvoices, fetchAll, createInvoice, deleteInvoice, startAuction, cancelAuction, closeAuction, payFinancedInvoice } = useInvoiceFinance();
    const [tab, setTab] = useState<CompanyTab>('invoices');
    const [showCreate, setShowCreate] = useState(false);
    const [startAuctionInvoice, setStartAuctionInvoice] = useState<InvoiceDto | null>(null);
    const [closeResult, setCloseResult] = useState<CloseAuctionResult | null>(null);

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const hasActive = openAuctions.length > 0;
    const activeAuction = openAuctions[0];

    useEffect(() => {
        fetchAll();
        const iv = setInterval(fetchAll, 15000);
        return () => clearInterval(iv);
    }, []);

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 40px' }}>
            {/* Section header */}
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} style={{ marginBottom: 28 }}>
                <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 24, background: C.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    Make Your Invoices Irresistible 💘
                </h2>
                <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Attract funding, get paid early, stay cashflow-positive.</p>
            </motion.div>

            {/* Summary stats cascade */}
            <motion.div variants={stagger} initial="hidden" animate="visible" style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Pending Invoices" value={invoices.length} color={C.primary} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Active Auction" value={openAuctions.length} color={openAuctions.length > 0 ? C.gold : C.muted} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Financed" value={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} color={C.green} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Paid Out" value={paidInvoices.length} color={C.muted} /></motion.div>
            </motion.div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${C.border}`, marginBottom: 24 }}>
                <Tab label="📋 My Invoices" active={tab === 'invoices'} count={invoices.length} onClick={() => setTab('invoices')} accent={C.primary} />
                <Tab label="⚡ Live Auction" active={tab === 'auction'} count={openAuctions.length} onClick={() => setTab('auction')} accent={C.primary} />
                <Tab label="🏦 Financed" active={tab === 'financed'} count={financedInvoices.filter(i => i.paymentStatus !== 'PAID').length} onClick={() => setTab('financed')} accent={C.primary} />
                <Tab label="📦 Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.primary} />
            </div>

            {/* Close result banner */}
            <AnimatePresence>
                {closeResult && (
                    <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                        style={{ background: closeResult.noWinner ? '#FFF3CD' : '#D1FAE5', border: `1px solid ${closeResult.noWinner ? '#FFC107' : C.green}`, borderRadius: 12, padding: '14px 18px', marginBottom: 20, position: 'relative' }}
                    >
                        {closeResult.noWinner
                            ? <span>⚠️ <strong>Auction closed with no bids.</strong> Invoice returned to your list.</span>
                            : <span>🎉 <strong>Match made!</strong> {closeResult.winningInstitutionDisplayName ?? 'An institution'} won at <strong>{closeResult.winningRate?.toFixed(2)}%</strong> — you received <strong>{fmt$(closeResult.purchaseAmount)}</strong> early payment.</span>
                        }
                        <button onClick={() => setCloseResult(null)} style={{ position: 'absolute', right: 14, top: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Tab: Invoices */}
            <AnimatePresence mode="wait">
                {tab === 'invoices' && (
                    <motion.div key="invoices" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h4 style={{ margin: 0, fontWeight: 800, color: C.text }}>My Invoices</h4>
                            <CupidBtn onClick={() => setShowCreate(true)} style={{ background: C.gradient }}>+ Create Invoice</CupidBtn>
                        </div>
                        {invoices.length === 0 ? (
                            <EmptyState icon="📋" message="No invoices yet. Create your first invoice to attract funding." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {invoices.map(inv => (
                                    <TiltCard key={inv.contractId}>
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
                                                    <span style={{ fontSize: 11, background: '#FFE8EF', color: C.primary, padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                                                        💘 {daysUntil(inv.dueDate) > 60 ? 'High appeal' : daysUntil(inv.dueDate) > 30 ? 'Good appeal' : 'Urgent — launch soon'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                                                <CupidBtn small color={C.muted} variant="outline" onClick={() => deleteInvoice(inv.contractId)}>Delete</CupidBtn>
                                                {!hasActive && (
                                                    <CupidBtn small style={{ background: C.gradient }} onClick={() => setStartAuctionInvoice(inv)}>🚀 Launch Auction</CupidBtn>
                                                )}
                                                {hasActive && (
                                                    <span style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', paddingTop: 4 }}>Auction active</span>
                                                )}
                                            </div>
                                        </div>
                                    </TiltCard>
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
                                            <CupidBtn color={C.green} onClick={() => payFinancedInvoice(inv.contractId)}>Pay Invoice</CupidBtn>
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

            {/* Modals */}
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

// ─── Auction Bid Card (Institution "Discovery" view) ─────────────────────────

const AuctionDiscoveryCard: React.FC<{
    auction: FinancingAuctionDto;
    bidStatus?: { hasBid: boolean; isWinning: boolean; myRate?: number | null; currentBestRate?: number | null; averageBid?: number | null };
    onBid: (rate: number) => Promise<any>;
}> = ({ auction, bidStatus, onBid }) => {
    const [rate, setRate] = useState<string>(bidStatus?.myRate != null ? bidStatus.myRate.toFixed(2) : auction.reserveRate.toFixed(2));
    const [bidding, setBidding] = useState(false);
    const endTime = auction.auctionEndTime ? new Date(auction.auctionEndTime) : null;
    const daysLeft = endTime ? Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 86400000)) : null;
    const endDateStr = endTime ? endTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    const hasBid = bidStatus?.hasBid ?? false;
    const isWinning = bidStatus?.isWinning ?? false;
    const bestRate = bidStatus?.currentBestRate ?? auction.currentBestRate;

    // "Match score" — higher amount + longer time = better
    const matchScore = Math.min(99, Math.round(60 + (auction.amount / 200000) * 20 + (daysLeft ?? 0) * 0.5));

    const handleBid = async () => {
        const r = parseFloat(rate);
        if (isNaN(r) || r <= 0) return;
        setBidding(true);
        try { await onBid(r); } finally { setBidding(false); }
    };

    return (
        <TiltCard style={{ border: hasBid ? `2px solid ${C.gold}` : `1px solid ${C.border}` }}>
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
                <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 16 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: C.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{matchScore}</span>
                        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>MATCH</span>
                    </div>
                    {bestRate != null && (
                        <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: C.primary }}>{bestRate.toFixed(2)}%</div>
                            <div style={{ fontSize: 10, color: C.muted }}>best rate</div>
                        </div>
                    )}
                </div>
            </div>

            {hasBid && bidStatus?.myRate != null && (
                <div style={{ background: isWinning ? '#D1FAE5' : '#FFF8F0', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: isWinning ? C.green : C.gold }}>
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
                        style={{ width: '100%', padding: '10px 12px', border: `2px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                    />
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Lower rate = better match. Bids are sealed.
                        {(auction.averageBid != null) && (
                            <span style={{ marginLeft: 8, fontWeight: 700, color: C.gold }}>
                                Market avg: {(auction.averageBid as number).toFixed(2)}%
                            </span>
                        )}
                    </div>
                </div>
                <CupidBtn
                    color={C.gold}
                    disabled={bidding || !rate}
                    onClick={handleBid}
                    style={{ whiteSpace: 'nowrap', flexShrink: 0, background: bidding ? C.muted : C.instGrad }}
                >
                    {bidding ? '…' : hasBid ? '💕 Update Bid' : '💘 Connect & Bid'}
                </CupidBtn>
            </div>
        </TiltCard>
    );
};

// ─── Institution "Discovery" Dashboard ─────────────────────────────────────

type InstitutionTab = 'discover' | 'loans' | 'archive';

const DiscoveryDashboard: React.FC = () => {
    const { auctions, financedInvoices, paidInvoices, bankOwnerships, bidStatuses, fetchAll, placeBid, getMyBidStatus } = useInvoiceFinance();
    const [tab, setTab] = useState<InstitutionTab>('discover');

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const activeLoans = financedInvoices.filter(i => i.paymentStatus !== 'PAID');

    useEffect(() => {
        fetchAll();
        const iv = setInterval(fetchAll, 15000);
        return () => clearInterval(iv);
    }, []);

    useEffect(() => {
        openAuctions.forEach(a => { if (!bidStatuses[a.contractId]) getMyBidStatus(a.contractId); });
    }, [auctions]);

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 40px' }}>
            {/* Section header */}
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} style={{ marginBottom: 28 }}>
                <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 24, background: C.instGrad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    Discover Your Perfect Match 💕
                </h2>
                <p style={{ margin: 0, color: C.muted, fontSize: 14 }}>Browse live auctions, place confidential bids, earn yield at maturity.</p>
            </motion.div>

            {/* Summary stats */}
            <motion.div variants={stagger} initial="hidden" animate="visible" style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Open Auctions" value={openAuctions.length} color={C.primary} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="My Bids Placed" value={Object.values(bidStatuses).filter(b => b.hasBid).length} color={C.gold} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Active Loans" value={activeLoans.length} color={C.green} /></motion.div>
                <motion.div variants={fadeUp} style={{ flex: 1, minWidth: 120 }}><Stat label="Settled" value={paidInvoices.length} color={C.muted} /></motion.div>
            </motion.div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${C.border}`, marginBottom: 24 }}>
                <Tab label="💘 Discover" active={tab === 'discover'} count={openAuctions.length} onClick={() => setTab('discover')} accent={C.gold} />
                <Tab label="💼 My Loans" active={tab === 'loans'} count={activeLoans.length} onClick={() => setTab('loans')} accent={C.gold} />
                <Tab label="📦 Archive" active={tab === 'archive'} count={paidInvoices.length} onClick={() => setTab('archive')} accent={C.gold} />
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
                {tab === 'discover' && (
                    <motion.div key="discover" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
                        <h4 style={{ margin: '0 0 16px', fontWeight: 800, color: C.text }}>Open Auctions</h4>
                        {openAuctions.length === 0 ? (
                            <EmptyState icon="💕" message="No open auctions right now. Check back soon." />
                        ) : (
                            <motion.div variants={stagger} initial="hidden" animate="visible">
                                {openAuctions.map(a => (
                                    <AuctionDiscoveryCard
                                        key={a.contractId}
                                        auction={a}
                                        bidStatus={bidStatuses[a.contractId]}
                                        onBid={rate => placeBid(a.contractId, { offeredRate: rate })}
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
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ fontSize: 36 }}>💘</motion.div>
            </div>
        );
    }

    if (user === null) return null;

    if (!myProfile) return <ProfileSetupModal onSave={saveMyProfile} />;

    const isCompany = myProfile.type === 'COMPANY';

    return (
        <div style={{ background: 'linear-gradient(160deg, #FFF0F5 0%, #FFE4EE 40%, #FFF5E8 100%)', minHeight: '100vh', paddingTop: 24 }}>
            {isCompany ? <AttractionDashboard /> : <DiscoveryDashboard />}
        </div>
    );
};

export default DashboardView;
