// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useInvoiceFinance } from '../stores/invoiceFinanceStore';
import { useProfile } from '../stores/profileStore';
import { useUserStore } from '../stores/userStore';
import { useToast } from '../stores/toastStore';
import type {
    FinancingAuctionDto,
    FinancedInvoiceDto,
    UserProfileDto,
    UpdateProfileRequest,
} from '../openapi.d.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SECTORS = [
    'Agriculture', 'Construction', 'Education', 'Energy', 'Finance',
    'Healthcare', 'Hospitality', 'Legal', 'Logistics', 'Manufacturing',
    'Media', 'Real Estate', 'Retail', 'Technology', 'Telecommunications',
    'Transportation', 'Other',
];

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4,
};

function fmt$(n: number | undefined | null) {
    if (n == null) return '—';
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status chip
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
    PENDING_CONFIRMATION: { bg: '#fef3c7', fg: '#92400e' },
    CONFIRMED:            { bg: '#d1fae5', fg: '#065f46' },
    IN_AUCTION:           { bg: '#ede9fe', fg: '#4c1d95' },
    FINANCED:             { bg: '#dbeafe', fg: '#1e40af' },
    PAID:                 { bg: '#d1fae5', fg: '#065f46' },
    ACTIVE:               { bg: '#dbeafe', fg: '#1e40af' },
    SPRINT_BOOST_ACTIVE:  { bg: '#fef3c7', fg: '#92400e' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Stat Card
// ─────────────────────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: number | string; color: string }> = ({ label, value, color }) => (
    <div style={{ background: '#fff', border: `1px solid ${color}33`, borderRadius: 10, padding: '14px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: typeof value === 'string' ? 18 : 28, fontWeight: 900, color }}>{value}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => (
    <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontSize: 14 }}>{message}</div>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Company Info Card (shown on auction cards)
// ─────────────────────────────────────────────────────────────────────────────

const CompanyCard: React.FC<{ profile: UserProfileDto | null; partyId: string }> = ({ profile, partyId }) => {
    if (!profile?.displayName) return (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Party: {partyId.slice(0, 30)}…</div>
    );
    return (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12 }}>
            <span style={{ fontWeight: 700, color: '#065f46', fontSize: 13 }}>🏭 {profile.displayName}</span>
            {profile.sector && <span>📊 {profile.sector}</span>}
            {profile.annualRevenue && <span>💰 Rev: {fmt$(profile.annualRevenue)}/yr</span>}
            {profile.employeeCount && <span>👥 {profile.employeeCount} employees</span>}
            {profile.foundedYear && <span>📅 Est. {profile.foundedYear}</span>}
            {profile.description && (
                <div style={{ width: '100%', color: '#6b7280', fontStyle: 'italic', marginTop: 2 }}>
                    {profile.description.slice(0, 120)}{profile.description.length > 120 ? '…' : ''}
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Dutch Auction Ticker (top-level component — NOT defined inside render)
// ─────────────────────────────────────────────────────────────────────────────

interface AuctionTickerProps {
    auction: FinancingAuctionDto;
    supplierProfile: UserProfileDto | null;
    canBid: boolean;
    isSupplier: boolean;
    onGrab: (offeredRate: number) => void;
    onCancel: () => void;
}

const AuctionTicker: React.FC<AuctionTickerProps> = ({ auction, supplierProfile, canBid, isSupplier, onGrab, onCancel }) => {
    const totalSecs = auction.auctionDurationSecs ?? 120;
    const [elapsed, setElapsed] = useState(0);
    const ref = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        setElapsed(0);
        ref.current = setInterval(() => setElapsed(p => {
            if (p >= totalSecs) { if (ref.current) clearInterval(ref.current); return totalSecs; }
            return p + 1;
        }), 1000);
        return () => { if (ref.current) clearInterval(ref.current); };
    }, [auction.contractId, totalSecs]);

    const progress = Math.min(elapsed / totalSecs, 1);
    const spread = (auction.startRate ?? 0) - (auction.reserveRate ?? 0);
    const currentRate = Math.max((auction.startRate ?? 0) - spread * progress, auction.reserveRate ?? 0);
    const currentAmount = ((auction.amount ?? 0) * currentRate) / 100;
    const isExpired = elapsed >= totalSecs;

    return (
        <div style={{ border: '2px solid #4f46e5', borderRadius: 14, padding: 20, marginBottom: 16, background: isExpired ? '#f9fafb' : 'linear-gradient(135deg,#1e1b4b,#312e81)', color: isExpired ? '#6b7280' : '#fff' }}>
            {!isExpired && <div style={{ marginBottom: 12 }}><CompanyCard profile={supplierProfile} partyId={auction.supplier ?? ''} /></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Invoice #{auction.invoiceId}</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{auction.description}</div>
                    <div style={{ fontSize: 13, marginTop: 4, opacity: 0.85 }}>
                        Face value: <strong>{fmt$(auction.amount)}</strong> · Due: {auction.dueDate}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 40, fontWeight: 900, color: isExpired ? '#9ca3af' : '#fbbf24' }}>
                        {currentRate.toFixed(2)}%
                    </div>
                    <div style={{ fontSize: 15, opacity: 0.9 }}>{fmt$(currentAmount)} advance</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{isExpired ? 'Auction ended' : `⏱ ${totalSecs - elapsed}s left`}</div>
                </div>
            </div>
            <div style={{ margin: '14px 0 4px', background: 'rgba(255,255,255,0.15)', borderRadius: 4, height: 8 }}>
                <div style={{ width: `${progress * 100}%`, height: '100%', background: '#fbbf24', borderRadius: 4, transition: 'width 1s linear' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.65 }}>
                <span>{auction.startRate}% start</span><span>{auction.reserveRate}% floor</span>
            </div>
            {canBid && !isExpired && (
                <button style={{ marginTop: 14, width: '100%', padding: '13px 0', fontSize: 17, fontWeight: 800, background: '#f59e0b', color: '#1c1917', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                    onClick={() => onGrab(parseFloat(currentRate.toFixed(4)))}>
                    🤜 FUND at {currentRate.toFixed(2)}%
                </button>
            )}
            {!canBid && !isSupplier && !isExpired && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.55, textAlign: 'center' }}>Only eligible institutions can bid</div>
            )}
            {isSupplier && (
                <button style={{ marginTop: 10, fontSize: 12, background: 'none', border: '1px solid rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.6)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                    onClick={onCancel}>
                    ✕ Cancel Auction
                </button>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Horse Race progress (top-level)
// ─────────────────────────────────────────────────────────────────────────────

const HorseRace: React.FC<{ invoice: FinancedInvoiceDto }> = ({ invoice }) => {
    const due = new Date(invoice.dueDate ?? Date.now());
    const pct = Math.min(Math.max(0, 1 - (due.getTime() - Date.now()) / (90 * 86400 * 1000)) * 100, 100);
    const isSprint = invoice.sprintBoostActive;
    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                <span>Financed</span><span>Due {invoice.dueDate}</span>
            </div>
            <div style={{ position: 'relative', background: '#e5e7eb', borderRadius: 999, height: 22, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: isSprint ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'linear-gradient(90deg,#4f46e5,#7c3aed)', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6 }}>
                    <span style={{ fontSize: 14 }}>{isSprint ? '🚀' : '🐎'}</span>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Invoice Upload — calls Anthropic API client-side
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
            // Convert file to base64
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            // Use chunked approach to avoid stack overflow on large files
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const fileBase64 = btoa(binary);
            const mimeType = file.type || 'image/jpeg';

            const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY ?? '';

            if (!apiKey) {
                // No API key — extract what we can from the filename and mock the rest
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
                toast.displaySuccess('Fields partially filled from filename. Add VITE_ANTHROPIC_API_KEY to .env.local for full AI parsing.');
                return;
            }

            const prompt = `Extract invoice data from this document. Return ONLY a JSON object with exactly these fields:
{
  "invoiceNumber": "string or null",
  "vendorName": "string or null",
  "amount": number or null,
  "issueDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "description": "brief description of goods/services or null"
}
Do not include any text, markdown, or explanation outside the JSON.`;

            const body = JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } },
                        { type: 'text', text: prompt },
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

            if (!resp.ok) {
                throw new Error(`Anthropic API error: ${resp.status}`);
            }

            const data = await resp.json();
            let text: string = data?.content?.[0]?.text ?? '';

            // Strip markdown fences if present
            text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

            const parsed = JSON.parse(text);

            const toDateStr = (v: unknown): string => {
                if (!v) return '';
                const s = String(v).trim();
                // Validate YYYY-MM-DD format
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                // Try to parse other formats
                const d = new Date(s);
                if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                return '';
            };

            onParsed({
                invoiceId: parsed.invoiceNumber ?? '',
                amount: parsed.amount != null ? String(parsed.amount) : '',
                description: parsed.description ?? (parsed.vendorName ? `Invoice from ${parsed.vendorName}` : ''),
                issueDate: toDateStr(parsed.issueDate),
                dueDate: toDateStr(parsed.dueDate),
            });
            setStatus('parsed');
        } catch (err) {
            console.error('Invoice parse error:', err);
            setStatus('error');
            toast.displayError('Could not parse invoice — please fill in the fields manually.');
        } finally {
            setLoading(false);
            // Reset file input so the same file can be re-uploaded
            e.target.value = '';
        }
    }, [onParsed, toast]);

    return (
        <div style={{ border: '2px dashed #4f46e5', borderRadius: 10, padding: 16, background: '#f5f3ff', textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#4f46e5', marginBottom: 4 }}>🤖 AI Invoice Parser</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                Upload an invoice image or PDF — fields auto-fill instantly
            </div>
            <label style={{ cursor: loading ? 'wait' : 'pointer' }}>
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" style={{ display: 'none' }} onChange={handleFile} disabled={loading} />
                <span style={{ display: 'inline-block', padding: '8px 20px', background: loading ? '#a5b4fc' : '#4f46e5', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, transition: 'background 0.2s' }}>
                    {loading ? '⏳ Parsing…' : '📎 Upload Invoice'}
                </span>
            </label>
            {status === 'parsed' && (
                <div style={{ fontSize: 12, color: '#065f46', marginTop: 6, fontWeight: 600 }}>✅ {fileName} — fields populated below</div>
            )}
            {status === 'error' && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>⚠️ Parse failed — fill in manually</div>
            )}
            {status === 'idle' && fileName && !loading && (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{fileName}</div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Profile Onboarding Modal (top-level)
// ─────────────────────────────────────────────────────────────────────────────

const ProfileModal: React.FC<{ onSave: (req: UpdateProfileRequest) => void }> = ({ onSave }) => {
    const [form, setForm] = useState<UpdateProfileRequest>({
        displayName: '', type: 'COMPANY', sector: 'Technology',
        annualRevenue: undefined, employeeCount: undefined, foundedYear: undefined,
        description: '', website: '',
    });

    const set = (key: keyof UpdateProfileRequest) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
            setForm(f => ({ ...f, [key]: e.target.value }));
    const setNum = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }));

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 520, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Welcome to Deadline Derby 🏇</h2>
                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>Tell us about yourself to get started</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))} style={{ flex: 1, padding: '12px 0', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer', border: '2px solid', borderColor: form.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#e5e7eb', background: form.type === t ? (t === 'COMPANY' ? '#ede9fe' : '#d1fae5') : '#f9fafb', color: form.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#6b7280' }}>
                            {t === 'COMPANY' ? '🏭 Company' : '🏦 Institution'}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ gridColumn: '1/-1' }}>
                        <label style={labelStyle}>{form.type === 'COMPANY' ? 'Company Name' : 'Institution Name'} *</label>
                        <input className="form-control" placeholder={form.type === 'COMPANY' ? 'Acme Manufacturing Corp' : 'First Capital Bank'} value={form.displayName} onChange={set('displayName')} />
                    </div>
                    <div>
                        <label style={labelStyle}>Sector</label>
                        <select className="form-control" value={form.sector ?? ''} onChange={set('sector')}>
                            {SECTORS.map(s => <option key={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Founded Year</label>
                        <input className="form-control" type="number" placeholder="2015" value={form.foundedYear ?? ''} onChange={setNum('foundedYear')} />
                    </div>
                    <div>
                        <label style={labelStyle}>Annual Revenue (USD)</label>
                        <input className="form-control" type="number" placeholder="1000000" value={form.annualRevenue ?? ''} onChange={setNum('annualRevenue')} />
                    </div>
                    <div>
                        <label style={labelStyle}>Employees</label>
                        <input className="form-control" type="number" placeholder="50" value={form.employeeCount ?? ''} onChange={setNum('employeeCount')} />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                        <label style={labelStyle}>Website</label>
                        <input className="form-control" placeholder="https://..." value={form.website ?? ''} onChange={set('website')} />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                        <label style={labelStyle}>About / Business Model</label>
                        <textarea className="form-control" rows={2} placeholder={form.type === 'COMPANY' ? 'B2B manufacturer of industrial components for automotive sector' : 'Providing short-term trade finance to mid-market companies'} value={form.description ?? ''} onChange={set('description')} style={{ resize: 'vertical' }} />
                    </div>
                </div>
                <button
                    style={{ marginTop: 20, width: '100%', padding: '14px 0', fontWeight: 800, fontSize: 16, background: form.displayName.trim() ? '#4f46e5' : '#e5e7eb', color: form.displayName.trim() ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, cursor: form.displayName.trim() ? 'pointer' : 'not-allowed' }}
                    onClick={() => form.displayName.trim() && onSave(form)}
                >
                    Get Started →
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Financed Invoice Card (top-level)
// ─────────────────────────────────────────────────────────────────────────────

interface FinancedCardProps {
    invoice: FinancedInvoiceDto;
    isCompany: boolean;
    showSprintForm: string | null;
    setShowSprintForm: (v: string | null) => void;
    bountyAmount: string;
    setBountyAmount: (v: string) => void;
    activateSprintBoost: (cid: string, req: { bountyAmount: number }) => Promise<void>;
    payFinancedInvoice: (cid: string) => Promise<void>;
}

const FinancedInvoiceCard: React.FC<FinancedCardProps> = ({
    invoice, isCompany, showSprintForm, setShowSprintForm, bountyAmount, setBountyAmount, activateSprintBoost, payFinancedInvoice,
}) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 12, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
                <div style={{ fontWeight: 700 }}>Invoice #{invoice.invoiceId}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{invoice.description}</div>
                <div style={{ fontSize: 13 }}>Face value: <strong>{fmt$(invoice.amount)}</strong></div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Funded by: {invoice.bank?.slice(0, 30)}…</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <StatusChip status={invoice.paymentStatus ?? ''} />
                {isCompany && invoice.paymentStatus === 'ACTIVE' && (
                    showSprintForm === invoice.contractId ? (
                        <div>
                            <input className="form-control mb-1" type="number" placeholder="Bounty ($)" value={bountyAmount} onChange={e => setBountyAmount(e.target.value)} style={{ fontSize: 12 }} />
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-warning" onClick={() => { activateSprintBoost(invoice.contractId ?? '', { bountyAmount: parseFloat(bountyAmount) }); setShowSprintForm(null); }}>🚀 Boost</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setShowSprintForm(null)}>✕</button>
                            </div>
                        </div>
                    ) : (
                        <button className="btn btn-sm btn-warning" onClick={() => setShowSprintForm(invoice.contractId ?? '')}>🚀 Sprint Boost</button>
                    )
                )}
                {isCompany && (invoice.paymentStatus === 'ACTIVE' || invoice.paymentStatus === 'SPRINT_BOOST_ACTIVE') && (
                    <button className="btn btn-sm btn-success" onClick={() => payFinancedInvoice(invoice.contractId ?? '')}>💰 Pay Now</button>
                )}
            </div>
        </div>
        <HorseRace invoice={invoice} />
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Form State
// ─────────────────────────────────────────────────────────────────────────────

interface InvoiceFormState {
    invoiceId: string; buyerParty: string; amount: string; description: string;
    paymentTermDays: string; issueDate: string; dueDate: string;
}

const emptyInvoiceForm = (): InvoiceFormState => ({
    invoiceId: '', buyerParty: '', amount: '', description: '',
    paymentTermDays: '90', issueDate: new Date().toISOString().split('T')[0], dueDate: '',
});

// ─────────────────────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────────────────────

const DeadlineDerbyView: React.FC = () => {
    const {
        invoices, auctions, financedInvoices, bankOwnerships, paidInvoices,
        fetchAll, createInvoice, startAuction, deleteInvoice,
        grabAuction, cancelAuction, payFinancedInvoice, activateSprintBoost,
        lastGrabResult,
    } = useInvoiceFinance();

    const { myProfile, fetchMyProfile, saveMyProfile, fetchProfile } = useProfile();
    const { user, fetchUser } = useUserStore();
    const toast = useToast();

    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileChecked, setProfileChecked] = useState(false);
    const [tab, setTab] = useState<'dashboard' | 'auctions' | 'portfolio' | 'profile'>('dashboard');

    // Invoice form
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm());
    const [showAuctionForm, setShowAuctionForm] = useState<string | null>(null);
    const [auctionForm, setAuctionForm] = useState({ eligibleInstitutions: '', startRate: '8', reserveRate: '3', auctionDurationSecs: '120' });
    const [restrictBanks, setRestrictBanks] = useState(false);
    const [showSprintForm, setShowSprintForm] = useState<string | null>(null);
    const [bountyAmount, setBountyAmount] = useState('500');
    const [bankPartyOverride, setBankPartyOverride] = useState('');
    const [auctionProfiles, setAuctionProfiles] = useState<Record<string, UserProfileDto | null>>({});

    // Init
    useEffect(() => {
        fetchUser();
        fetchMyProfile().then(() => setProfileChecked(true));
        fetchAll();
        const id = setInterval(fetchAll, 5000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (profileChecked && !myProfile) setShowProfileModal(true);
    }, [profileChecked, myProfile]);

    // Load supplier profiles for auctions
    useEffect(() => {
        auctions.forEach(a => {
            const id = a.supplier ?? '';
            if (id && !(id in auctionProfiles)) {
                fetchProfile(id).then(p => setAuctionProfiles(prev => ({ ...prev, [id]: p })));
            }
        });
    }, [auctions]);

    const isCompany = myProfile?.type === 'COMPANY';
    const isInstitution = myProfile?.type === 'INSTITUTION';
    const roleColor = isCompany ? '#4f46e5' : isInstitution ? '#065f46' : '#7c3aed';
    const roleLabel = isCompany ? '🏭 ' + (myProfile?.displayName || 'Company')
        : isInstitution ? '🏦 ' + (myProfile?.displayName || 'Institution')
            : '⚙️ Platform';

    // ── Handlers ──────────────────────────────────────────────────────────────

    const setIF = (key: keyof InvoiceFormState) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setInvoiceForm(f => ({ ...f, [key]: e.target.value }));

    const handleCreateInvoice = async () => {
        // Validate required fields and show helpful messages
        if (!invoiceForm.invoiceId.trim()) {
            toast.displayError('Please enter an Invoice Number');
            return;
        }
        if (!invoiceForm.amount || isNaN(parseFloat(invoiceForm.amount))) {
            toast.displayError('Please enter the Invoice Amount');
            return;
        }
        if (!invoiceForm.dueDate) {
            toast.displayError('Please enter the Due Date');
            return;
        }

        // Auto-fill buyer party with current user's party if not set
        // (For demo: supplier self-confirms, or leave blank to use operator party)
        const buyerParty = invoiceForm.buyerParty.trim() || user?.party || '';
        if (!buyerParty) {
            toast.displayError('Could not determine your party ID — please enter a Buyer Party ID');
            return;
        }

        await createInvoice({
            invoiceId: invoiceForm.invoiceId.trim(),
            buyerParty,
            amount: parseFloat(invoiceForm.amount),
            description: invoiceForm.description.trim(),
            paymentTermDays: parseInt(invoiceForm.paymentTermDays) || 90,
            issueDate: invoiceForm.issueDate || new Date().toISOString().split('T')[0],
            dueDate: invoiceForm.dueDate,
        });
        setShowCreateForm(false);
        setInvoiceForm(emptyInvoiceForm());
    };

    const handleStartAuction = async (contractId: string) => {
        // If restricting, parse the comma-separated list; otherwise send empty (backend auto-fills all institutions)
        const banks = restrictBanks
            ? auctionForm.eligibleInstitutions.split(',').map(s => s.trim()).filter(Boolean)
            : [];
        if (restrictBanks && banks.length === 0) {
            toast.displayError('Enter at least one institution party ID or disable the restriction');
            return;
        }
        await startAuction(contractId, {
            eligibleBanks: banks,
            startRate: parseFloat(auctionForm.startRate),
            reserveRate: parseFloat(auctionForm.reserveRate),
            auctionDurationSecs: parseInt(auctionForm.auctionDurationSecs),
        });
        setShowAuctionForm(null);
        setRestrictBanks(false);
    };

    const handleGrab = async (auction: FinancingAuctionDto, offeredRate: number) => {
        const bankParty = bankPartyOverride.trim() || user?.party || '';
        await grabAuction(auction.contractId ?? '', { bankParty, offeredRate });
    };

    // ── Tab: Company Dashboard ────────────────────────────────────────────────

    const renderCompanyDashboard = () => (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
                <StatCard label="Invoices" value={invoices.length} color="#4f46e5" />
                <StatCard label="In Auction" value={invoices.filter(i => i.status === 'IN_AUCTION').length} color="#f59e0b" />
                <StatCard label="Financed" value={financedInvoices.length} color="#0891b2" />
                <StatCard label="Paid Out" value={paidInvoices.length} color="#065f46" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📄 My Invoices</h2>
                <button className="btn btn-primary" style={{ fontWeight: 700 }} onClick={() => setShowCreateForm(v => !v)}>
                    + Request Financing
                </button>
            </div>

            {showCreateForm && (
                <div style={{ border: '1px solid #c7d2fe', borderRadius: 12, padding: 20, marginBottom: 16, background: '#fafafa' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>New Financing Request</h3>

                    <AIInvoiceUpload onParsed={fields => setInvoiceForm(f => ({ ...f, ...fields }))} />

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <label style={labelStyle}>Invoice Number *</label>
                            <input className="form-control" placeholder="INV-2025-0001" value={invoiceForm.invoiceId} onChange={setIF('invoiceId')} />
                        </div>
                        <div>
                            <label style={labelStyle}>
                                Buyer Party ID
                                <span style={{ fontWeight: 400, color: '#6b7280' }}> (leave blank to self-confirm)</span>
                            </label>
                            <input className="form-control" placeholder={user?.party?.slice(0, 30) + '…' || 'Auto-filled with your party'} value={invoiceForm.buyerParty} onChange={setIF('buyerParty')} />
                        </div>
                        <div>
                            <label style={labelStyle}>Invoice Amount (USD) *</label>
                            <input className="form-control" type="number" placeholder="50000" value={invoiceForm.amount} onChange={setIF('amount')} />
                        </div>
                        <div>
                            <label style={labelStyle}>Payment Terms (days)</label>
                            <input className="form-control" type="number" value={invoiceForm.paymentTermDays} onChange={setIF('paymentTermDays')} />
                        </div>
                        <div>
                            <label style={labelStyle}>Issue Date</label>
                            <input className="form-control" type="date" value={invoiceForm.issueDate} onChange={setIF('issueDate')} />
                        </div>
                        <div>
                            <label style={labelStyle}>Due Date *</label>
                            <input className="form-control" type="date" value={invoiceForm.dueDate} onChange={setIF('dueDate')} />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                            <label style={labelStyle}>Description</label>
                            <input className="form-control" placeholder="e.g. 10,000 steel bolts — Purchase Order #4421" value={invoiceForm.description} onChange={setIF('description')} />
                        </div>
                    </div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button className="btn btn-primary" style={{ fontWeight: 700 }} onClick={handleCreateInvoice}>
                            Submit Request
                        </button>
                        <button className="btn btn-secondary" onClick={() => { setShowCreateForm(false); setInvoiceForm(emptyInvoiceForm()); }}>
                            Cancel
                        </button>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>Fields marked * are required</span>
                    </div>
                </div>
            )}

            {invoices.length === 0 ? (
                <EmptyState icon="📄" message="No invoices yet — click 'Request Financing' to get started" />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {invoices.map(inv => (
                        <div key={inv.contractId} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', background: '#fff' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 15 }}>{inv.description || inv.invoiceId}</div>
                                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                        #{inv.invoiceId} · {fmt$(inv.amount)} · Due {inv.dueDate}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <StatusChip status={inv.status ?? ''} />
                                    {inv.status === 'CONFIRMED' && (
                                        showAuctionForm === inv.contractId ? (
                                            <div style={{ minWidth: 320 }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                                                    <div>
                                                        <label style={{ ...labelStyle, marginBottom: 2 }}>Max Rate %</label>
                                                        <input className="form-control" type="number" step="0.1" value={auctionForm.startRate} onChange={e => setAuctionForm(f => ({ ...f, startRate: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label style={{ ...labelStyle, marginBottom: 2 }}>Min Rate %</label>
                                                        <input className="form-control" type="number" step="0.1" value={auctionForm.reserveRate} onChange={e => setAuctionForm(f => ({ ...f, reserveRate: e.target.value }))} />
                                                    </div>
                                                    <div>
                                                        <label style={{ ...labelStyle, marginBottom: 2 }}>Duration (s)</label>
                                                        <input className="form-control" type="number" value={auctionForm.auctionDurationSecs} onChange={e => setAuctionForm(f => ({ ...f, auctionDurationSecs: e.target.value }))} />
                                                    </div>
                                                </div>
                                                <div style={{ marginBottom: 6, padding: '8px 10px', background: '#f0fdf4', borderRadius: 6, fontSize: 12, color: '#065f46' }}>
                                                    All registered institutions can bid by default.
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, cursor: 'pointer', fontWeight: 600, color: '#374151' }}>
                                                        <input type="checkbox" checked={restrictBanks} onChange={e => setRestrictBanks(e.target.checked)} />
                                                        Restrict to specific institutions
                                                    </label>
                                                </div>
                                                {restrictBanks && (
                                                    <div style={{ marginBottom: 6 }}>
                                                        <label style={{ ...labelStyle, marginBottom: 2 }}>Institution Party IDs (comma-separated)</label>
                                                        <input className="form-control" style={{ fontSize: 11 }} placeholder="Party::bank1::..., Party::bank2::..." value={auctionForm.eligibleInstitutions} onChange={e => setAuctionForm(f => ({ ...f, eligibleInstitutions: e.target.value }))} />
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleStartAuction(inv.contractId ?? '')}>🔨 Start Auction</button>
                                                    <button className="btn btn-sm btn-secondary" onClick={() => { setShowAuctionForm(null); setRestrictBanks(false); }}>Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button className="btn btn-sm btn-primary" onClick={() => setShowAuctionForm(inv.contractId ?? '')}>
                                                🔨 Open to Bids
                                            </button>
                                        )
                                    )}
                                    {(inv.status === 'CONFIRMED' || inv.status === 'PENDING_CONFIRMATION') && showAuctionForm !== inv.contractId && (
                                        <button
                                            className="btn btn-sm"
                                            style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
                                            onClick={() => deleteInvoice(inv.contractId ?? '')}
                                        >
                                            🗑 Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {financedInvoices.length > 0 && (
                <div style={{ marginTop: 28 }}>
                    <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>🐎 Active Financing</h2>
                    {financedInvoices.map(fi => (
                        <FinancedInvoiceCard key={fi.contractId} invoice={fi} isCompany={isCompany}
                            showSprintForm={showSprintForm} setShowSprintForm={setShowSprintForm}
                            bountyAmount={bountyAmount} setBountyAmount={setBountyAmount}
                            activateSprintBoost={activateSprintBoost} payFinancedInvoice={payFinancedInvoice} />
                    ))}
                </div>
            )}
        </div>
    );

    // ── Tab: Institution Dashboard ────────────────────────────────────────────

    const renderInstitutionDashboard = () => (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
                <StatCard label="Open Auctions" value={auctions.filter(a => a.status === 'OPEN').length} color="#065f46" />
                <StatCard label="Active Loans" value={bankOwnerships.length} color="#0891b2" />
                <StatCard label="Total Deployed" value={fmt$(bankOwnerships.reduce((s, b) => s + (b.purchaseAmount ?? 0), 0))} color="#4f46e5" />
            </div>

            <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                <label style={labelStyle}>Your Institution Party ID <span style={{ fontWeight: 400, color: '#6b7280' }}>(leave blank to use your auth party)</span></label>
                <input className="form-control" placeholder={user?.party?.slice(0, 40) + '…' || 'Auto-detected'} value={bankPartyOverride} onChange={e => setBankPartyOverride(e.target.value)} style={{ fontSize: 12, marginTop: 4 }} />
            </div>

            <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>⚡ Live Auctions — Fund a Business</h2>
            {auctions.length === 0 ? (
                <EmptyState icon="⚡" message="No open auctions right now — check back soon" />
            ) : (
                auctions.map(a => (
                    <AuctionTicker key={a.contractId} auction={a} supplierProfile={auctionProfiles[a.supplier ?? ''] ?? null}
                        canBid={isInstitution} isSupplier={false}
                        onGrab={rate => handleGrab(a, rate)}
                        onCancel={() => cancelAuction(a.contractId ?? '')} />
                ))
            )}

            {lastGrabResult && (
                <div style={{ background: '#d1fae5', border: '2px solid #065f46', borderRadius: 10, padding: 16, marginTop: 8 }}>
                    <div style={{ fontWeight: 800, color: '#065f46', fontSize: 16 }}>🏆 Bid Won!</div>
                    <div style={{ fontSize: 13, marginTop: 4, color: '#064e3b' }}>
                        Rate: <strong>{lastGrabResult.purchaseRate?.toFixed(2)}%</strong> · Funded: <strong>{fmt$(lastGrabResult.purchaseAmount)}</strong>
                    </div>
                </div>
            )}

            {bankOwnerships.length > 0 && (
                <div style={{ marginTop: 24 }}>
                    <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>🔒 My Portfolio (Confidential)</h2>
                    <table className="table table-fixed" style={{ fontSize: 13 }}>
                        <thead><tr><th>Invoice</th><th>Rate</th><th>Funded</th><th>Face Value</th><th>Return</th></tr></thead>
                        <tbody>
                            {bankOwnerships.map(bo => (
                                <tr key={bo.contractId}>
                                    <td><code style={{ fontSize: 11 }}>{bo.invoiceId}</code></td>
                                    <td style={{ fontWeight: 700, color: '#065f46' }}>{bo.purchaseRate?.toFixed(2)}%</td>
                                    <td>{fmt$(bo.purchaseAmount)}</td>
                                    <td>{fmt$(bo.faceValue)}</td>
                                    <td style={{ color: '#065f46', fontWeight: 600 }}>
                                        {fmt$((bo.faceValue ?? 0) - (bo.purchaseAmount ?? 0))}
                                        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>
                                            ({(((bo.faceValue ?? 0) - (bo.purchaseAmount ?? 0)) / (bo.purchaseAmount ?? 1) * 100).toFixed(1)}%)
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );

    // ── Tab: Profile ──────────────────────────────────────────────────────────

    const ProfileTabContent: React.FC = () => {
        const [editForm, setEditForm] = useState<UpdateProfileRequest>({
            displayName: myProfile?.displayName ?? '',
            type: (myProfile?.type as 'COMPANY' | 'INSTITUTION') ?? 'COMPANY',
            sector: myProfile?.sector ?? 'Technology',
            annualRevenue: myProfile?.annualRevenue ?? undefined,
            employeeCount: myProfile?.employeeCount ?? undefined,
            foundedYear: myProfile?.foundedYear ?? undefined,
            description: myProfile?.description ?? '',
            website: myProfile?.website ?? '',
        });
        const [saved, setSaved] = useState(false);

        const setE = (key: keyof UpdateProfileRequest) =>
            (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
                setEditForm(f => ({ ...f, [key]: e.target.value }));
        const setENum = (key: keyof UpdateProfileRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
            setEditForm(f => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }));

        return (
            <div style={{ maxWidth: 520 }}>
                <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>My Profile</h2>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {(['COMPANY', 'INSTITUTION'] as const).map(t => (
                        <button key={t} onClick={() => setEditForm(f => ({ ...f, type: t }))} style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: '2px solid', borderColor: editForm.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#e5e7eb', background: editForm.type === t ? (t === 'COMPANY' ? '#ede9fe' : '#d1fae5') : '#f9fafb', color: editForm.type === t ? (t === 'COMPANY' ? '#4f46e5' : '#065f46') : '#6b7280' }}>
                            {t === 'COMPANY' ? '🏭 Company' : '🏦 Institution'}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Display Name</label><input className="form-control" value={editForm.displayName} onChange={setE('displayName')} /></div>
                    <div><label style={labelStyle}>Sector</label><select className="form-control" value={editForm.sector ?? ''} onChange={setE('sector')}>{SECTORS.map(s => <option key={s}>{s}</option>)}</select></div>
                    <div><label style={labelStyle}>Founded Year</label><input className="form-control" type="number" value={editForm.foundedYear ?? ''} onChange={setENum('foundedYear')} /></div>
                    <div><label style={labelStyle}>Annual Revenue (USD)</label><input className="form-control" type="number" value={editForm.annualRevenue ?? ''} onChange={setENum('annualRevenue')} /></div>
                    <div><label style={labelStyle}>Employees</label><input className="form-control" type="number" value={editForm.employeeCount ?? ''} onChange={setENum('employeeCount')} /></div>
                    <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Website</label><input className="form-control" value={editForm.website ?? ''} onChange={setE('website')} /></div>
                    <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>Description</label><textarea className="form-control" rows={3} value={editForm.description ?? ''} onChange={setE('description')} style={{ resize: 'vertical' }} /></div>
                </div>
                <button style={{ marginTop: 14, padding: '10px 24px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
                    onClick={async () => { await saveMyProfile(editForm); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
                    {saved ? '✓ Saved!' : 'Save Profile'}
                </button>
                {user?.party && (
                    <div style={{ marginTop: 16, padding: '10px 12px', background: '#f3f4f6', borderRadius: 8, fontSize: 11, color: '#6b7280', wordBreak: 'break-all' }}>
                        <strong>Your Party ID:</strong> {user.party}
                    </div>
                )}
            </div>
        );
    };

    // ── Main render ───────────────────────────────────────────────────────────

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {showProfileModal && <ProfileModal onSave={async req => { await saveMyProfile(req); setShowProfileModal(false); }} />}

            {/* Header */}
            <div style={{ background: `linear-gradient(135deg, ${roleColor}18, ${roleColor}06)`, border: `2px solid ${roleColor}33`, borderRadius: 14, padding: '18px 24px', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: roleColor }}>🏇 Deadline Derby</h1>
                        <p style={{ margin: '3px 0 0', color: '#6b7280', fontSize: 13 }}>Confidential Invoice Financing on Canton Network</p>
                    </div>
                    <div style={{ background: roleColor, color: '#fff', padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
                        {roleLabel}
                    </div>
                </div>
            </div>

            {/* Nav tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e5e7eb' }}>
                {([
                    ['dashboard', isCompany ? '📊 My Invoices' : '📊 Dashboard'] as const,
                    ['auctions',  isCompany ? '📤 Auctions'   : '⚡ Fund Businesses'] as const,
                    ['portfolio', isCompany ? '🐎 Financing'  : '🔒 Portfolio'] as const,
                    ['profile', '👤 Profile'] as const,
                ]).map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)} style={{ padding: '8px 16px', fontWeight: tab === key ? 700 : 400, fontSize: 14, background: 'none', border: 'none', borderBottom: tab === key ? `3px solid ${roleColor}` : '3px solid transparent', color: tab === key ? roleColor : '#6b7280', cursor: 'pointer', marginBottom: -2 }}>
                        {label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {tab === 'dashboard' && (isCompany ? renderCompanyDashboard() : renderInstitutionDashboard())}
            {tab === 'auctions' && (
                isCompany ? (
                    <div>
                        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>My Live Auctions</h2>
                        {auctions.filter(a => a.supplier === user?.party).length === 0
                            ? <EmptyState icon="⚡" message="No active auctions — confirm an invoice then start bidding" />
                            : auctions.filter(a => a.supplier === user?.party).map(a => (
                                <AuctionTicker key={a.contractId} auction={a} supplierProfile={myProfile}
                                    canBid={false} isSupplier={true} onGrab={() => {}}
                                    onCancel={() => cancelAuction(a.contractId ?? '')} />
                            ))
                        }
                    </div>
                ) : renderInstitutionDashboard()
            )}
            {tab === 'portfolio' && (
                isCompany ? (
                    <div>
                        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>🐎 Active Financing</h2>
                        {financedInvoices.length === 0 ? <EmptyState icon="🐎" message="No financed invoices yet" />
                            : financedInvoices.map(fi => (
                                <FinancedInvoiceCard key={fi.contractId} invoice={fi} isCompany={true}
                                    showSprintForm={showSprintForm} setShowSprintForm={setShowSprintForm}
                                    bountyAmount={bountyAmount} setBountyAmount={setBountyAmount}
                                    activateSprintBoost={activateSprintBoost} payFinancedInvoice={payFinancedInvoice} />
                            ))
                        }
                        {paidInvoices.length > 0 && (
                            <>
                                <h2 style={{ margin: '24px 0 12px', fontSize: 18, fontWeight: 800 }}>✅ Settled</h2>
                                <table className="table table-fixed" style={{ fontSize: 13 }}>
                                    <thead><tr><th>Invoice</th><th>Amount</th><th>Sprint?</th><th>Bounty</th></tr></thead>
                                    <tbody>{paidInvoices.map(p => <tr key={p.contractId}><td><code style={{ fontSize: 11 }}>{p.invoiceId}</code></td><td>{fmt$(p.amount)}</td><td>{p.sprintBoosted ? '🚀' : '—'}</td><td>{fmt$(p.bountyPaid)}</td></tr>)}</tbody>
                                </table>
                            </>
                        )}
                    </div>
                ) : renderInstitutionDashboard()
            )}
            {tab === 'profile' && <ProfileTabContent />}

            {/* Canton privacy footer */}
            <div style={{ background: '#1e1b4b', color: '#c7d2fe', borderRadius: 12, padding: 18, marginTop: 32, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: 8 }}>🔐 Canton Privacy</div>
                <div style={{ lineHeight: 1.7 }}>
                    <strong style={{ color: '#e0e7ff' }}>WinningBid:</strong> Only the winning institution sees the bid price — losing institutions get zero bytes.{' '}
                    <strong style={{ color: '#e0e7ff' }}>BankOwnership:</strong> Purchase rate is hidden from the company — ledger-enforced, not just app-level.{' '}
                    <strong style={{ color: '#e0e7ff' }}>Global Synchronizer:</strong> Only sees cryptographic hashes.
                </div>
            </div>
        </div>
    );
};

export default DeadlineDerbyView;
