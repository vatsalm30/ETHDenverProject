// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SECTORS = [
    'Agriculture', 'Construction', 'Education', 'Energy', 'Finance',
    'Healthcare', 'Hospitality', 'Legal', 'Logistics', 'Manufacturing',
    'Media', 'Real Estate', 'Retail', 'Technology', 'Telecommunications',
    'Transportation', 'Other',
];

function fmt$(n: number | undefined | null) {
    if (n == null) return '—';
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function daysUntil(dateStr: string | null | undefined): number {
    if (!dateStr) return 0;
    return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI primitives
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
    PENDING_CONFIRMATION: { bg: '#fef3c7', fg: '#92400e' },
    CONFIRMED:            { bg: '#d1fae5', fg: '#065f46' },
    IN_AUCTION:           { bg: '#ede9fe', fg: '#4c1d95' },
    FINANCED:             { bg: '#dbeafe', fg: '#1e40af' },
    PAID:                 { bg: '#d1fae5', fg: '#065f46' },
    ACTIVE:               { bg: '#dbeafe', fg: '#1e40af' },
    OPEN:                 { bg: '#d1fae5', fg: '#065f46' },
    CLOSED:               { bg: '#f3f4f6', fg: '#6b7280' },
};

const StatusChip: React.FC<{ status: string }> = ({ status }) => {
    const c = STATUS_COLORS[status] || { bg: '#f3f4f6', fg: '#374151' };
    return (
        <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

const EmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => (
    <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
        <div style={{ fontSize: 14 }}>{message}</div>
    </div>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16, ...style }}>
        {children}
    </div>
);

const Btn: React.FC<{
    onClick?: () => void;
    color?: string;
    variant?: 'solid' | 'outline';
    small?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ onClick, color = '#4f46e5', variant = 'solid', small, disabled, children, style }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        style={{
            padding: small ? '6px 12px' : '10px 18px',
            fontSize: small ? 12 : 14,
            fontWeight: 700,
            borderRadius: 8,
            border: variant === 'outline' ? `2px solid ${color}` : 'none',
            background: disabled ? '#e5e7eb' : variant === 'outline' ? 'transparent' : color,
            color: disabled ? '#9ca3af' : variant === 'outline' ? color : '#fff',
            cursor: disabled ? 'default' : 'pointer',
            ...style,
        }}
    >
        {children}
    </button>
);

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '2px solid #e5e7eb',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Invoice Upload
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedFields {
    invoiceId?: string;
    amount?: string;
    description?: string;
    issueDate?: string;
    dueDate?: string;
}

const AIInvoiceUpload: React.FC<{ onParsed: (fields: ParsedFields) => void }> = ({ onParsed }) => {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'parsed' | 'error'>('idle');
    const [fileName, setFileName] = useState('');
    const toast = useToast();

    const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        setLoading(true);
        setStatus('idle');
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const fileBase64 = btoa(binary);
            const mimeType = file.type || 'image/jpeg';
            const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY ?? '';

            if (!apiKey) {
                const today = new Date().toISOString().split('T')[0];
                const due = new Date(Date.now() + 90 * 86400 * 1000).toISOString().split('T')[0];
                onParsed({
                    invoiceId: 'INV-' + Date.now().toString().slice(-6),
                    amount: '',
                    description: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
                    issueDate: today,
                    dueDate: due,
                });
                setStatus('parsed');
                toast.displaySuccess('Fields partially filled. Add VITE_ANTHROPIC_API_KEY for full AI parsing.');
                return;
            }

            const body = JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } },
                        { type: 'text', text: `Extract invoice data. Return ONLY JSON: {"invoiceNumber":"","amount":null,"issueDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","description":""}` },
                    ],
                }],
            });

            const resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body,
            });

            if (!resp.ok) throw new Error(`API error: ${resp.status}`);
            const data = await resp.json();
            let text: string = data?.content?.[0]?.text ?? '';
            text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(text);
            const toDate = (v: unknown) => {
                if (!v) return '';
                const s = String(v).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                const d = new Date(s);
                return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
            };
            onParsed({
                invoiceId: parsed.invoiceNumber ?? '',
                amount: parsed.amount != null ? String(parsed.amount) : '',
                description: parsed.description ?? '',
                issueDate: toDate(parsed.issueDate),
                dueDate: toDate(parsed.dueDate),
            });
            setStatus('parsed');
        } catch {
            setStatus('error');
            toast.displayError('Could not parse invoice — fill in manually.');
        } finally {
            setLoading(false);
            e.target.value = '';
        }
    }, [onParsed, toast]);

    return (
        <div style={{ border: '2px dashed #4f46e5', borderRadius: 10, padding: 14, background: '#f5f3ff', textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#4f46e5', marginBottom: 4 }}>🤖 AI Invoice Parser</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Upload an invoice image/PDF to auto-fill fields</div>
            <label style={{ cursor: loading ? 'wait' : 'pointer' }}>
                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
                <span style={{ display: 'inline-block', padding: '6px 16px', background: loading ? '#a5b4fc' : '#4f46e5', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                    {loading ? '⏳ Parsing…' : '📎 Upload Invoice'}
                </span>
            </label>
            {status === 'parsed' && <div style={{ fontSize: 11, color: '#065f46', marginTop: 6, fontWeight: 600 }}>✅ {fileName} — fields populated</div>}
            {status === 'error' && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 6 }}>⚠️ Parse failed — fill manually</div>}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Profile Setup Modal (shown when profile is missing)
// ─────────────────────────────────────────────────────────────────────────────

const ProfileSetupModal: React.FC<{ onSave: (req: UpdateProfileRequest) => Promise<void> }> = ({ onSave }) => {
    const [form, setForm] = useState<UpdateProfileRequest>({
        displayName: '', type: 'COMPANY', sector: 'Technology',
        annualRevenue: undefined, employeeCount: undefined, foundedYear: undefined,
        description: '', website: '',
    });
    const [saving, setSaving] = useState(false);

    const set = (key: keyof UpdateProfileRequest) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
            setForm(f => ({ ...f, [key]: e.target.value }));
    const setNum = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.displayName?.trim()) return;
        setSaving(true);
        try { await onSave(form); } finally { setSaving(false); }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Welcome! Set Up Your Profile</h2>
                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>Tell us about yourself to get started</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))} style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer', border: '2px solid', borderColor: form.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#e5e7eb', background: form.type === t ? (t === 'COMPANY' ? '#ede9fe' : '#d1fae5') : '#f9fafb', color: form.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#6b7280' }}>
                            {t === 'COMPANY' ? '🏭 Company' : '🏦 Institution'}
                        </button>
                    ))}
                </div>
                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={labelStyle}>{form.type === 'COMPANY' ? 'Company' : 'Institution'} Name *</label>
                            <input className="form-control" value={form.displayName} onChange={set('displayName')} placeholder={form.type === 'COMPANY' ? 'Acme Corp' : 'First Capital Bank'} required />
                        </div>
                        <div>
                            <label style={labelStyle}>Sector</label>
                            <select className="form-control" value={form.sector ?? ''} onChange={set('sector')}>
                                {SECTORS.map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Founded Year</label>
                            <input className="form-control" type="number" placeholder="2010" value={form.foundedYear ?? ''} onChange={setNum('foundedYear')} />
                        </div>
                        {form.type === 'COMPANY' && <>
                            <div>
                                <label style={labelStyle}>Annual Revenue ($)</label>
                                <input className="form-control" type="number" placeholder="5000000" value={form.annualRevenue ?? ''} onChange={setNum('annualRevenue')} />
                            </div>
                            <div>
                                <label style={labelStyle}>Employees</label>
                                <input className="form-control" type="number" placeholder="50" value={form.employeeCount ?? ''} onChange={setNum('employeeCount')} />
                            </div>
                        </>}
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={labelStyle}>Description</label>
                            <textarea className="form-control" rows={2} placeholder="Brief description…" value={form.description ?? ''} onChange={set('description')} />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={labelStyle}>Website</label>
                            <input className="form-control" placeholder="https://example.com" value={form.website ?? ''} onChange={set('website')} />
                        </div>
                    </div>
                    <button type="submit" disabled={saving || !form.displayName?.trim()} className="btn btn-primary mt-3 w-100" style={{ fontWeight: 700, fontSize: 16 }}>
                        {saving ? 'Saving…' : 'Get Started →'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Creation Form (modal)
// ─────────────────────────────────────────────────────────────────────────────

const InvoiceCreateModal: React.FC<{ onClose: () => void; onCreate: (req: CreateInvoiceRequest) => Promise<void> }> = ({ onClose, onCreate }) => {
    const today = new Date().toISOString().split('T')[0];
    const defaultDue = new Date(Date.now() + 90 * 86400 * 1000).toISOString().split('T')[0];

    const [form, setForm] = useState({
        invoiceId: 'INV-' + Date.now().toString().slice(-6),
        buyerParty: 'buyer-party',
        amount: '',
        description: '',
        paymentTermDays: '90',
        issueDate: today,
        dueDate: defaultDue,
    });
    const [saving, setSaving] = useState(false);

    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value }));

    const handleParsed = (fields: ParsedFields) => {
        setForm(f => ({
            ...f,
            ...(fields.invoiceId ? { invoiceId: fields.invoiceId } : {}),
            ...(fields.amount ? { amount: fields.amount } : {}),
            ...(fields.description ? { description: fields.description } : {}),
            ...(fields.issueDate ? { issueDate: fields.issueDate } : {}),
            ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await onCreate({
                invoiceId: form.invoiceId,
                buyerParty: form.buyerParty,
                amount: parseFloat(form.amount),
                description: form.description,
                paymentTermDays: parseInt(form.paymentTermDays),
                issueDate: form.issueDate,
                dueDate: form.dueDate,
            });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontWeight: 800 }}>Create Invoice</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
                </div>
                <AIInvoiceUpload onParsed={handleParsed} />
                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <label style={labelStyle}>Invoice ID *</label>
                            <input style={inputStyle} value={form.invoiceId} onChange={set('invoiceId')} required />
                        </div>
                        <div>
                            <label style={labelStyle}>Amount ($) *</label>
                            <input style={inputStyle} type="number" min="1" value={form.amount} onChange={set('amount')} placeholder="100000" required />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={labelStyle}>Description *</label>
                            <input style={inputStyle} value={form.description} onChange={set('description')} placeholder="10,000 steel bolts" required />
                        </div>
                        <div>
                            <label style={labelStyle}>Issue Date *</label>
                            <input style={inputStyle} type="date" value={form.issueDate} onChange={set('issueDate')} required />
                        </div>
                        <div>
                            <label style={labelStyle}>Due Date *</label>
                            <input style={inputStyle} type="date" value={form.dueDate} onChange={set('dueDate')} required />
                        </div>
                        <div>
                            <label style={labelStyle}>Payment Terms (days)</label>
                            <input style={inputStyle} type="number" value={form.paymentTermDays} onChange={set('paymentTermDays')} />
                        </div>
                        <div>
                            <label style={labelStyle}>Buyer Party ID</label>
                            <input style={inputStyle} value={form.buyerParty} onChange={set('buyerParty')} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                        <Btn color="#6b7280" variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn color="#4f46e5" disabled={saving} style={{ flex: 2 }}>
                            {saving ? 'Creating…' : 'Create Invoice'}
                        </Btn>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Start Auction Form (modal)
// ─────────────────────────────────────────────────────────────────────────────

const StartAuctionModal: React.FC<{
    invoice: InvoiceDto;
    onClose: () => void;
    onStart: (req: StartAuctionRequest) => Promise<void>;
}> = ({ invoice, onClose, onStart }) => {
    const maxDays = daysUntil(invoice.dueDate);
    const [durationDays, setDurationDays] = useState(Math.min(7, maxDays));
    const [startRate, setStartRate] = useState(99);
    const [reserveRate, setReserveRate] = useState(95);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await onStart({
                auctionDurationDays: durationDays,
                auctionDurationSecs: durationDays * 86400,
                startRate,
                reserveRate,
                eligibleBanks: [],  // auto-populated from institution profiles
            });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontWeight: 800 }}>Start Auction</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
                </div>
                <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 16px', marginBottom: 18, fontSize: 13 }}>
                    <div style={{ fontWeight: 700, color: '#1f2937' }}>Invoice #{invoice.invoiceId}</div>
                    <div style={{ color: '#6b7280' }}>{invoice.description} · {fmt$(invoice.amount)} · Due {invoice.dueDate}</div>
                </div>
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: 14 }}>
                        <label style={labelStyle}>Auction Duration (days, max {maxDays})</label>
                        <input style={inputStyle} type="number" min={1} max={maxDays} value={durationDays} onChange={e => setDurationDays(parseInt(e.target.value))} required />
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Institutions have this many days to place bids</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        <div>
                            <label style={labelStyle}>Start Rate (%) — opening</label>
                            <input style={inputStyle} type="number" step="0.1" value={startRate} onChange={e => setStartRate(parseFloat(e.target.value))} />
                        </div>
                        <div>
                            <label style={labelStyle}>Reserve Rate (%) — minimum</label>
                            <input style={inputStyle} type="number" step="0.1" value={reserveRate} onChange={e => setReserveRate(parseFloat(e.target.value))} />
                        </div>
                    </div>
                    <div style={{ background: '#ede9fe', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: '#4f46e5' }}>
                        <strong>Sealed-bid auction:</strong> Institutions bid privately. Lowest rate wins when you close. You'll see only the best rate and bid count — never which institution bid.
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <Btn color="#6b7280" variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn color="#4f46e5" disabled={saving} style={{ flex: 2 }}>
                            {saving ? 'Starting…' : 'Start Sealed-Bid Auction'}
                        </Btn>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Company Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type CompanyTab = 'invoices' | 'auction' | 'financed' | 'archive';

const CompanyDashboard: React.FC = () => {
    const {
        invoices, auctions, financedInvoices, paidInvoices,
        fetchAll, createInvoice, deleteInvoice, startAuction,
        cancelAuction, closeAuction, payFinancedInvoice,
    } = useInvoiceFinance();
    const [tab, setTab] = useState<CompanyTab>('invoices');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [startAuctionInvoice, setStartAuctionInvoice] = useState<InvoiceDto | null>(null);
    const [closeResult, setCloseResult] = useState<CloseAuctionResult | null>(null);

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const hasActiveAuction = openAuctions.length > 0;
    const activeAuction = openAuctions[0];

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 15000);
        return () => clearInterval(interval);
    }, []);

    const handleCloseAuction = async (contractId: string) => {
        const result = await closeAuction(contractId);
        if (result) setCloseResult(result);
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 }}>
                {([
                    { key: 'invoices', label: '📋 My Invoices', count: invoices.length, highlight: false },
                    { key: 'auction', label: '⚡ Active Auction', count: openAuctions.length, highlight: hasActiveAuction },
                    { key: 'financed', label: '🏦 Financed', count: financedInvoices.filter(i => i.paymentStatus !== 'PAID').length, highlight: false },
                    { key: 'archive', label: '📦 Archive', count: paidInvoices.length, highlight: false },
                ] as Array<{ key: CompanyTab; label: string; count: number; highlight: boolean }>).map(({ key, label, count, highlight }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key as CompanyTab)}
                        style={{
                            padding: '10px 18px',
                            fontWeight: 700,
                            fontSize: 14,
                            border: 'none',
                            background: 'none',
                            borderBottom: tab === key ? '3px solid #4f46e5' : '3px solid transparent',
                            color: tab === key ? '#4f46e5' : '#6b7280',
                            cursor: 'pointer',
                            marginBottom: -2,
                        }}
                    >
                        {label}
                        {count > 0 && (
                            <span style={{ marginLeft: 6, background: highlight ? '#4f46e5' : '#e5e7eb', color: highlight ? '#fff' : '#374151', padding: '1px 7px', borderRadius: 999, fontSize: 11 }}>
                                {count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Close auction success banner */}
            {closeResult && (
                <div style={{ background: closeResult.noWinner ? '#fef3c7' : '#d1fae5', border: `1px solid ${closeResult.noWinner ? '#fbbf24' : '#34d399'}`, borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
                    {closeResult.noWinner ? (
                        <div>⚠️ <strong>Auction closed with no bids.</strong> Invoice returned to your invoices list.</div>
                    ) : (
                        <div>
                            🎉 <strong>Auction settled!</strong> {closeResult.winningInstitutionDisplayName ?? 'An institution'} won at <strong>{closeResult.winningRate?.toFixed(2)}%</strong> — you received <strong>{fmt$(closeResult.purchaseAmount)}</strong> early payment.
                        </div>
                    )}
                    <button onClick={() => setCloseResult(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, marginTop: -4 }}>✕</button>
                </div>
            )}

            {/* Tab: Invoices */}
            {tab === 'invoices' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <h4 style={{ margin: 0, fontWeight: 800 }}>My Invoices</h4>
                        <Btn onClick={() => setShowCreateModal(true)}>+ Create Invoice</Btn>
                    </div>
                    {invoices.length === 0 ? (
                        <EmptyState icon="📋" message="No invoices yet. Create your first invoice to get started." />
                    ) : (
                        invoices.map(inv => (
                            <Card key={inv.contractId}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 700 }}>#{inv.invoiceId}</span>
                                            <StatusChip status={inv.status} />
                                        </div>
                                        <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>{inv.description}</div>
                                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                                            {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)} days left
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                                        {inv.status === 'PENDING_CONFIRMATION' && (
                                            <Btn small color="#dc2626" variant="outline" onClick={() => deleteInvoice(inv.contractId)}>Delete</Btn>
                                        )}
                                        {(inv.status === 'CONFIRMED' || inv.status === 'PENDING_CONFIRMATION') && !hasActiveAuction && (
                                            <Btn small onClick={() => setStartAuctionInvoice(inv)}>Start Auction</Btn>
                                        )}
                                        {hasActiveAuction && inv.status === 'PENDING_CONFIRMATION' && (
                                            <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Active auction in progress</span>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* Tab: Active Auction */}
            {tab === 'auction' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>Active Auction</h4>
                    {!hasActiveAuction ? (
                        <EmptyState icon="⚡" message="No active auction. Start one from the My Invoices tab." />
                    ) : (
                        <AuctionStatusCard
                            auction={activeAuction}
                            onClose={() => handleCloseAuction(activeAuction.contractId)}
                            onCancel={() => cancelAuction(activeAuction.contractId)}
                        />
                    )}
                </div>
            )}

            {/* Tab: Financed Invoices */}
            {tab === 'financed' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>Financed Invoices</h4>
                    {financedInvoices.filter(i => i.paymentStatus !== 'PAID').length === 0 ? (
                        <EmptyState icon="🏦" message="No active financed invoices." />
                    ) : (
                        financedInvoices.filter(i => i.paymentStatus !== 'PAID').map(inv => (
                            <Card key={inv.contractId}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>#{inv.invoiceId}</div>
                                        <div style={{ fontSize: 14, color: '#1f2937' }}>{inv.description}</div>
                                        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                                            Face value: {fmt$(inv.amount)} · Due {inv.dueDate} · {daysUntil(inv.dueDate)} days
                                        </div>
                                    </div>
                                    <Btn color="#065f46" onClick={() => payFinancedInvoice(inv.contractId)}>Pay Invoice</Btn>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            )}

            {/* Tab: Archive */}
            {tab === 'archive' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>Former Financed Invoices</h4>
                    {paidInvoices.length === 0 ? (
                        <EmptyState icon="📦" message="No paid invoices yet." />
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#374151' }}>Invoice</th>
                                    <th style={{ padding: '10px 12px', fontWeight: 700, color: '#374151' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paidInvoices.map(inv => (
                                    <tr key={inv.contractId} style={{ borderTop: '1px solid #f3f4f6' }}>
                                        <td style={{ padding: '10px 12px' }}>#{inv.invoiceId} — {inv.description}</td>
                                        <td style={{ padding: '10px 12px' }}>{fmt$(inv.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Modals */}
            {showCreateModal && (
                <InvoiceCreateModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={createInvoice}
                />
            )}
            {startAuctionInvoice && (
                <StartAuctionModal
                    invoice={startAuctionInvoice}
                    onClose={() => setStartAuctionInvoice(null)}
                    onStart={(req) => startAuction(startAuctionInvoice.contractId, req)}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Auction Status Card (company view of their active auction)
// ─────────────────────────────────────────────────────────────────────────────

const AuctionStatusCard: React.FC<{
    auction: FinancingAuctionDto;
    onClose: () => void;
    onCancel: () => void;
}> = ({ auction, onClose, onCancel }) => {
    const endTime = auction.auctionEndTime ? new Date(auction.auctionEndTime) : null;
    const daysLeft = endTime ? Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 86400000)) : null;
    const hoursLeft = endTime ? Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 3600000)) : null;

    const timeDisplay = daysLeft != null
        ? daysLeft > 1 ? `${daysLeft} days remaining` : hoursLeft != null ? `${hoursLeft}h remaining` : ''
        : `${auction.auctionDurationSecs}s total`;

    return (
        <Card style={{ border: '2px solid #4f46e5', background: 'linear-gradient(135deg, #faf5ff, #eff6ff)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>Invoice #{auction.invoiceId}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937' }}>{auction.description}</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Face value: {fmt$(auction.amount)} · Due {auction.dueDate}</div>
                </div>
                <StatusChip status={auction.status} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: '#4f46e5' }}>
                        {auction.currentBestRate != null ? `${auction.currentBestRate.toFixed(1)}%` : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Best Rate</div>
                </div>
                <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: '#7c3aed' }}>
                        {auction.bidCount ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Bids Received</div>
                </div>
                <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#065f46' }}>{timeDisplay}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Time Left</div>
                </div>
            </div>

            <div style={{ background: '#ede9fe', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#4c1d95', marginBottom: 16 }}>
                🔒 Sealed bids are private. You can only see the best rate offered and total bid count — not who bid.
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
                <Btn color="#dc2626" variant="outline" small onClick={onCancel}>Cancel Auction</Btn>
                <Btn color="#065f46" onClick={onClose} style={{ flex: 1 }}>
                    Close Auction &amp; Settle with Best Bidder
                </Btn>
            </div>
        </Card>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Institution Dashboard
// ─────────────────────────────────────────────────────────────────────────────

type InstitutionTab = 'auctions' | 'loans' | 'archive';

const InstitutionDashboard: React.FC = () => {
    const {
        auctions, financedInvoices, paidInvoices, bankOwnerships, bidStatuses,
        fetchAll, placeBid, getMyBidStatus,
    } = useInvoiceFinance();
    const [tab, setTab] = useState<InstitutionTab>('auctions');

    const openAuctions = auctions.filter(a => a.status === 'OPEN');
    const activeLoans = financedInvoices.filter(i => i.paymentStatus !== 'PAID');

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 15000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // Load my bid status for all open auctions
        openAuctions.forEach(a => {
            if (!bidStatuses[a.contractId]) getMyBidStatus(a.contractId);
        });
    }, [auctions]);

    return (
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 }}>
                {([
                    { key: 'auctions', label: '⚡ Open Auctions', count: openAuctions.length, highlight: openAuctions.length > 0 },
                    { key: 'loans', label: '💼 My Loans', count: activeLoans.length, highlight: false },
                    { key: 'archive', label: '📦 Archive', count: paidInvoices.length, highlight: false },
                ] as Array<{ key: InstitutionTab; label: string; count: number; highlight: boolean }>).map(({ key, label, count, highlight }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key as InstitutionTab)}
                        style={{
                            padding: '10px 18px',
                            fontWeight: 700,
                            fontSize: 14,
                            border: 'none',
                            background: 'none',
                            borderBottom: tab === key ? '3px solid #065f46' : '3px solid transparent',
                            color: tab === key ? '#065f46' : '#6b7280',
                            cursor: 'pointer',
                            marginBottom: -2,
                        }}
                    >
                        {label}
                        {count > 0 && (
                            <span style={{ marginLeft: 6, background: highlight ? '#065f46' : '#e5e7eb', color: highlight ? '#fff' : '#374151', padding: '1px 7px', borderRadius: 999, fontSize: 11 }}>
                                {count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab: Open Auctions */}
            {tab === 'auctions' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>Open Auctions</h4>
                    {openAuctions.length === 0 ? (
                        <EmptyState icon="⚡" message="No open auctions available. Check back soon." />
                    ) : (
                        openAuctions.map(auction => (
                            <AuctionBidCard
                                key={auction.contractId}
                                auction={auction}
                                bidStatus={bidStatuses[auction.contractId]}
                                onBid={(rate) => placeBid(auction.contractId, { offeredRate: rate })}
                            />
                        ))
                    )}
                </div>
            )}

            {/* Tab: My Loans */}
            {tab === 'loans' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>My Loans</h4>
                    {activeLoans.length === 0 ? (
                        <EmptyState icon="💼" message="No active loans. Win an auction to start earning yield." />
                    ) : (
                        activeLoans.map(inv => {
                            const bo = bankOwnerships.find(b => b.invoiceId === inv.invoiceId);
                            return (
                                <Card key={inv.contractId}>
                                    <div style={{ fontWeight: 700, marginBottom: 4 }}>#{inv.invoiceId}</div>
                                    <div style={{ fontSize: 14, color: '#1f2937', marginBottom: 8 }}>{inv.description}</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                                        <LoanStat label="Face Value" value={fmt$(inv.amount)} />
                                        {bo && <LoanStat label="Purchase Rate" value={`${bo.purchaseRate.toFixed(2)}%`} />}
                                        {bo && <LoanStat label="Paid" value={fmt$(bo.purchaseAmount)} />}
                                    </div>
                                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
                                        Due {inv.dueDate} · {daysUntil(inv.dueDate)} days to maturity
                                    </div>
                                    {bo && (
                                        <div style={{ marginTop: 8, fontSize: 12, color: '#065f46', fontWeight: 600 }}>
                                            Expected yield: {fmt$((bo.faceValue ?? inv.amount) - bo.purchaseAmount)} at maturity
                                        </div>
                                    )}
                                </Card>
                            );
                        })
                    )}
                </div>
            )}

            {/* Tab: Archive */}
            {tab === 'archive' && (
                <div>
                    <h4 style={{ margin: '0 0 16px', fontWeight: 800 }}>Settled Loans</h4>
                    {paidInvoices.length === 0 ? (
                        <EmptyState icon="📦" message="No settled loans yet." />
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>Invoice</th>
                                    <th style={{ padding: '10px 12px', fontWeight: 700 }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paidInvoices.map(inv => (
                                    <tr key={inv.contractId} style={{ borderTop: '1px solid #f3f4f6' }}>
                                        <td style={{ padding: '10px 12px' }}>#{inv.invoiceId} — {inv.description}</td>
                                        <td style={{ padding: '10px 12px' }}>{fmt$(inv.amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

const LoanStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#065f46' }}>{value}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Auction Bid Card (institution view of an open auction)
// ─────────────────────────────────────────────────────────────────────────────

const AuctionBidCard: React.FC<{
    auction: FinancingAuctionDto;
    bidStatus?: { hasBid: boolean; isWinning: boolean; myRate?: number | null; currentBestRate?: number | null };
    onBid: (rate: number) => Promise<any>;
}> = ({ auction, bidStatus, onBid }) => {
    const [rate, setRate] = useState<string>(
        bidStatus?.myRate != null ? bidStatus.myRate.toFixed(2) : auction.reserveRate.toFixed(2)
    );
    const [bidding, setBidding] = useState(false);
    const endTime = auction.auctionEndTime ? new Date(auction.auctionEndTime) : null;
    const daysLeft = endTime ? Math.max(0, Math.ceil((endTime.getTime() - Date.now()) / 86400000)) : null;

    const handleBid = async () => {
        const r = parseFloat(rate);
        if (isNaN(r) || r <= 0) return;
        setBidding(true);
        try {
            await onBid(r);
        } finally {
            setBidding(false);
        }
    };

    const hasBid = bidStatus?.hasBid ?? false;
    const isWinning = bidStatus?.isWinning ?? false;
    const bestRate = bidStatus?.currentBestRate ?? auction.currentBestRate;

    return (
        <Card style={{ border: hasBid ? '2px solid #065f46' : '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>#{auction.invoiceId}</span>
                        {hasBid && (
                            <span style={{ background: isWinning ? '#d1fae5' : '#fef3c7', color: isWinning ? '#065f46' : '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                                {isWinning ? '🏆 WINNING' : '📋 BID PLACED'}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>{auction.description}</div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                        {fmt$(auction.amount)} · Due {auction.dueDate}
                        {daysLeft != null && ` · ${daysLeft}d to close`}
                    </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    {bestRate != null && (
                        <>
                            <div style={{ fontSize: 22, fontWeight: 900, color: '#4f46e5' }}>{bestRate.toFixed(2)}%</div>
                            <div style={{ fontSize: 11, color: '#6b7280' }}>current best</div>
                        </>
                    )}
                </div>
            </div>

            {hasBid && bidStatus?.myRate != null && (
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#065f46' }}>
                    Your bid: <strong>{bidStatus.myRate.toFixed(2)}%</strong>
                    {isWinning ? ' — you have the best offer!' : bestRate != null ? ` — current best is ${bestRate.toFixed(2)}%` : ''}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ ...labelStyle, marginBottom: 2 }}>
                        {hasBid ? 'Update your rate (%)' : 'Your offered rate (%)'}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            style={{ ...inputStyle, flex: 1 }}
                            type="number"
                            step="0.01"
                            min={auction.reserveRate}
                            max={auction.startRate}
                            value={rate}
                            onChange={e => setRate(e.target.value)}
                            placeholder={`${auction.reserveRate} – ${auction.startRate}`}
                        />
                        <Btn color="#065f46" disabled={bidding || !rate} onClick={handleBid} style={{ whiteSpace: 'nowrap' }}>
                            {bidding ? '…' : hasBid ? 'Update Bid' : 'Place Bid'}
                        </Btn>
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                        Lower rate = better chance of winning. Bids are sealed — nobody sees yours.
                    </div>
                </div>
            </div>
        </Card>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Dashboard View
// ─────────────────────────────────────────────────────────────────────────────

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
            navigate('/login');
        }
    }, [user, userLoading, navigate]);

    if (userLoading || (user !== null && myProfile === undefined)) {
        return <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading…</div>;
    }

    if (user === null) return null;

    if (!myProfile) {
        return <ProfileSetupModal onSave={saveMyProfile} />;
    }

    const isCompany = myProfile.type === 'COMPANY';

    return (
        <div>
            <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 24 }}>
                    {isCompany ? '🏭' : '🏦'} {myProfile.displayName ?? user.name}
                </h2>
                <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
                    {isCompany ? 'Company · Get early payment on your invoices' : 'Institution · Fund invoices and earn yield'}
                    {myProfile.sector && ` · ${myProfile.sector}`}
                </p>
            </div>
            {isCompany ? <CompanyDashboard /> : <InstitutionDashboard />}
        </div>
    );
};

export default DashboardView;
