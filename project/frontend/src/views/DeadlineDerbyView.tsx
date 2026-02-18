// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useRef, useState } from 'react';
import { useInvoiceFinance } from '../stores/invoiceFinanceStore';
import { useUserStore } from '../stores/userStore';
import type {
    // InvoiceDto,
    FinancingAuctionDto,
    FinancedInvoiceDto,
    // BankOwnershipDto,
    // PaidInvoiceDto,
} from '../openapi.d.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Role detection helpers
// ─────────────────────────────────────────────────────────────────────────────

type Role = 'supplier' | 'buyer' | 'bank' | 'operator';

function detectRole(party: string | undefined, user: { name?: string } | null): Role {
    if (!party && !user) return 'operator';
    const name = (user?.name || party || '').toLowerCase();
    if (name.includes('supplier') || name.includes('provider')) return 'supplier';
    if (name.includes('buyer')) return 'buyer';
    if (name.includes('bank') || name.includes('finance')) return 'bank';
    return 'operator';
}

const ROLE_COLORS: Record<Role, string> = {
    supplier: '#4f46e5',
    buyer:    '#0891b2',
    bank:     '#065f46',
    operator: '#7c3aed',
};

const ROLE_LABELS: Record<Role, string> = {
    supplier: '🏭 Supplier',
    buyer:    '🛒 Buyer',
    bank:     '🏦 Bank',
    operator: '⚙️ Operator (Platform)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Dutch Auction countdown ticker (simulated client-side)
// ─────────────────────────────────────────────────────────────────────────────

interface AuctionTickerProps {
    auction: FinancingAuctionDto;
    onGrab: (offeredRate: number) => void;
    canBid: boolean;
}

const AuctionTicker: React.FC<AuctionTickerProps> = ({ auction, onGrab, canBid }) => {
    const totalSecs = auction.auctionDurationSecs;
    const [elapsed, setElapsed] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        setElapsed(0);
        intervalRef.current = setInterval(() => {
            setElapsed(prev => {
                if (prev >= totalSecs) {
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    return totalSecs;
                }
                return prev + 1;
            });
        }, 1000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [auction.contractId, totalSecs]);

    const progress = Math.min(elapsed / totalSecs, 1);
    const spread = auction.startRate - auction.reserveRate;
    const currentRate = Math.max(auction.startRate - spread * progress, auction.reserveRate);
    const currentAmount = (auction.amount * currentRate) / 100;
    const isExpired = elapsed >= totalSecs;

    return (
        <div style={{
            border: '2px solid #4f46e5',
            borderRadius: 12,
            padding: 20,
            background: isExpired ? '#f3f4f6' : 'linear-gradient(135deg,#1e1b4b,#312e81)',
            color: isExpired ? '#6b7280' : '#fff',
            marginBottom: 16,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Invoice #{auction.invoiceId}</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>
                        {auction.description}
                    </div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>
                        Face value: <strong>${auction.amount.toLocaleString()}</strong> · Due: {auction.dueDate}
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 42, fontWeight: 900, color: isExpired ? '#6b7280' : '#fbbf24' }}>
                        {currentRate.toFixed(2)}%
                    </div>
                    <div style={{ fontSize: 16 }}>${currentAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} advance</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>
                        {isExpired ? 'Auction ended' : `${totalSecs - elapsed}s remaining`}
                    </div>
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ margin: '16px 0 0', background: 'rgba(255,255,255,0.15)', borderRadius: 4, height: 8 }}>
                <div style={{
                    width: `${progress * 100}%`,
                    height: '100%',
                    background: '#fbbf24',
                    borderRadius: 4,
                    transition: 'width 1s linear',
                }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                <span>{auction.startRate}% start</span>
                <span>{auction.reserveRate}% floor</span>
            </div>

            {canBid && !isExpired && (
                <button
                    style={{
                        marginTop: 16,
                        width: '100%',
                        padding: '14px 0',
                        fontSize: 18,
                        fontWeight: 700,
                        background: '#f59e0b',
                        color: '#1c1917',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        letterSpacing: 1,
                    }}
                    onClick={() => onGrab(parseFloat(currentRate.toFixed(4)))}
                >
                    🤜 GRAB at {currentRate.toFixed(2)}%
                </button>
            )}
            {!canBid && !isExpired && (
                <div style={{ marginTop: 12, fontSize: 13, opacity: 0.6, textAlign: 'center' }}>
                    Only eligible banks can bid in this auction
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Horse Race progress bar
// ─────────────────────────────────────────────────────────────────────────────

interface HorseRaceProps { invoice: FinancedInvoiceDto }

const HorseRace: React.FC<HorseRaceProps> = ({ invoice }) => {
    const today = new Date();
    const due = new Date(invoice.dueDate);
    const totalMs = due.getTime() - today.getTime();
    // We show "time elapsed since financing" as a rough progress
    const pct = Math.min(Math.max(0, 1 - totalMs / (90 * 86400 * 1000)) * 100, 100);
    const isSprint = invoice.sprintBoostActive;

    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                <span>Financed</span>
                <span>Due {invoice.dueDate}</span>
            </div>
            <div style={{ position: 'relative', background: '#e5e7eb', borderRadius: 999, height: 24, marginTop: 4, overflow: 'hidden' }}>
                <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: isSprint ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : 'linear-gradient(90deg,#4f46e5,#7c3aed)',
                    borderRadius: 999,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: 8,
                }}>
                    <span style={{ fontSize: 16 }}>{isSprint ? '🚀' : '🐎'}</span>
                </div>
            </div>
            {isSprint && (
                <div style={{ fontSize: 12, color: '#d97706', marginTop: 4, fontWeight: 600 }}>
                    🚀 Sprint Boost Active — Pay early, earn ${invoice.sprintBoostBounty.toLocaleString()} bounty!
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Badge (shows what each party can see)
// ─────────────────────────────────────────────────────────────────────────────

const PrivacyBadge: React.FC<{ label: string; visible: boolean }> = ({ label, visible }) => (
    <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: visible ? '#d1fae5' : '#fee2e2',
        color: visible ? '#065f46' : '#991b1b',
        marginRight: 4,
        marginBottom: 4,
    }}>
        {visible ? '✓' : '✗'} {label}
    </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────────────────────

const DeadlineDerbyView: React.FC = () => {
    const {
        invoices, auctions, financedInvoices, bankOwnerships, paidInvoices,
        fetchAll, createInvoice, confirmInvoice, startAuction,
        grabAuction, cancelAuction, payFinancedInvoice, activateSprintBoost,
        lastGrabResult,
    } = useInvoiceFinance();

    const { user, fetchUser } = useUserStore();
    const role = detectRole(user?.party, user);
    const roleColor = ROLE_COLORS[role];

    // Form state
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showAuctionForm, setShowAuctionForm] = useState<string | null>(null);
    const [showSprintForm, setShowSprintForm] = useState<string | null>(null);
    const [form, setForm] = useState({
        invoiceId: '', buyerParty: '', amount: '', description: '',
        paymentTermDays: '90', issueDate: new Date().toISOString().split('T')[0],
        dueDate: '', eligibleBanks: '', startRate: '98', reserveRate: '95',
        auctionDurationSecs: '60', bountyAmount: '400', bankParty: '',
    });

    useEffect(() => {
        fetchUser();
        fetchAll();
        const id = setInterval(fetchAll, 5000);
        return () => clearInterval(id);
    }, []);

    const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value }));

    const handleCreateInvoice = async () => {
        if (!form.invoiceId || !form.buyerParty || !form.amount || !form.dueDate) return;
        await createInvoice({
            invoiceId: form.invoiceId,
            buyerParty: form.buyerParty,
            amount: parseFloat(form.amount),
            description: form.description,
            paymentTermDays: parseInt(form.paymentTermDays),
            issueDate: form.issueDate,
            dueDate: form.dueDate,
        });
        setShowCreateForm(false);
        setForm(f => ({ ...f, invoiceId: '', buyerParty: '', amount: '', description: '' }));
    };

    const handleStartAuction = async (contractId: string) => {
        const banks = form.eligibleBanks.split(',').map(s => s.trim()).filter(Boolean);
        if (banks.length === 0) return;
        await startAuction(contractId, {
            eligibleBanks: banks,
            startRate: parseFloat(form.startRate),
            reserveRate: parseFloat(form.reserveRate),
            auctionDurationSecs: parseInt(form.auctionDurationSecs),
        });
        setShowAuctionForm(null);
    };

    const handleGrab = async (auction: FinancingAuctionDto, offeredRate: number) => {
        const bankParty = form.bankParty || user?.party || '';
        await grabAuction(auction.contractId, { bankParty, offeredRate });
    };

    const handleSprintBoost = async (contractId: string) => {
        await activateSprintBoost(contractId, { bountyAmount: parseFloat(form.bountyAmount) });
        setShowSprintForm(null);
    };

    const isBank = role === 'bank';
    const isSupplier = role === 'supplier';
    const isBuyer = role === 'buyer';
    const isOperator = role === 'operator';

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {/* Header */}
            <div style={{
                background: `linear-gradient(135deg, ${roleColor}22, ${roleColor}08)`,
                border: `2px solid ${roleColor}44`,
                borderRadius: 12,
                padding: '20px 24px',
                marginBottom: 24,
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: roleColor }}>
                            🏇 Deadline Derby
                        </h1>
                        <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
                            Confidential Invoice Financing on Canton Network
                        </p>
                    </div>
                    <div style={{
                        background: roleColor,
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 15,
                    }}>
                        {ROLE_LABELS[role]}
                    </div>
                </div>

                {/* Privacy model legend */}
                <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.6)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                        🔒 Canton Privacy Model — What <strong>{ROLE_LABELS[role]}</strong> can see:
                    </div>
                    <PrivacyBadge label="Invoices" visible={true} />
                    <PrivacyBadge label="Auction params" visible={true} />
                    <PrivacyBadge label="Winning bid price" visible={isBank || isSupplier || isOperator} />
                    <PrivacyBadge label="Financed invoice" visible={true} />
                    <PrivacyBadge label="Purchase rate (BankOwnership)" visible={isBank || isOperator} />
                    <PrivacyBadge label="Sprint boost negotiation" visible={isBank || isBuyer || isOperator} />
                    <PrivacyBadge label="Paid invoices" visible={true} />
                    {isBuyer && (
                        <div style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>
                            ℹ️ You see the invoice face value but NOT what rate the bank paid — Canton enforces this at the ledger level.
                        </div>
                    )}
                    {isBank && (
                        <div style={{ fontSize: 11, color: '#1e3a5f', marginTop: 6 }}>
                            ℹ️ You see your own BankOwnership (purchase rate), but other banks' bids are invisible. Even the Global Synchronizer only sees commitment hashes.
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Invoices ──────────────────────────────────────────────── */}
            <section style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h2 style={{ margin: 0 }}>📄 Invoices ({invoices.length})</h2>
                    {(isSupplier || isOperator) && (
                        <button
                            className="btn btn-primary"
                            onClick={() => setShowCreateForm(v => !v)}
                        >
                            + Create Invoice
                        </button>
                    )}
                </div>

                {showCreateForm && (
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f9fafb' }}>
                        <h3 style={{ margin: '0 0 12px' }}>New Invoice</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <input className="form-control" placeholder="Invoice ID (e.g. INV-2025-0001)" value={form.invoiceId} onChange={set('invoiceId')} />
                            <input className="form-control" placeholder="Buyer Party ID" value={form.buyerParty} onChange={set('buyerParty')} />
                            <input className="form-control" placeholder="Amount (USD)" type="number" value={form.amount} onChange={set('amount')} />
                            <input className="form-control" placeholder="Payment term (days)" type="number" value={form.paymentTermDays} onChange={set('paymentTermDays')} />
                            <input className="form-control" placeholder="Issue date" type="date" value={form.issueDate} onChange={set('issueDate')} />
                            <input className="form-control" placeholder="Due date" type="date" value={form.dueDate} onChange={set('dueDate')} />
                        </div>
                        <input className="form-control mt-2" placeholder="Description (e.g. 10,000 steel bolts)" value={form.description} onChange={set('description')} />
                        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary" onClick={handleCreateInvoice}>Create</button>
                            <button className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>Cancel</button>
                        </div>
                    </div>
                )}

                {invoices.length === 0 ? (
                    <div style={{ color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                        No invoices visible to this party
                    </div>
                ) : (
                    <table className="table table-fixed" style={{ fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th>Invoice ID</th>
                                <th>Description</th>
                                <th>Amount</th>
                                <th>Due</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.contractId}>
                                    <td><code style={{ fontSize: 11 }}>{inv.invoiceId}</code></td>
                                    <td>{inv.description}</td>
                                    <td>${inv.amount.toLocaleString()}</td>
                                    <td>{inv.dueDate}</td>
                                    <td>
                                        <StatusChip status={inv.status} />
                                    </td>
                                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {inv.status === 'PENDING_CONFIRMATION' && isBuyer && (
                                            <button className="btn btn-sm btn-success" onClick={() => confirmInvoice(inv.contractId)}>
                                                ✓ Confirm
                                            </button>
                                        )}
                                        {inv.status === 'CONFIRMED' && (isSupplier || isOperator) && (
                                            showAuctionForm === inv.contractId ? (
                                                <div style={{ minWidth: 280 }}>
                                                    <input className="form-control mb-1" placeholder="Eligible bank parties (comma-separated)" value={form.eligibleBanks} onChange={set('eligibleBanks')} style={{ fontSize: 12 }} />
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        <input className="form-control" placeholder="Start %" type="number" value={form.startRate} onChange={set('startRate')} style={{ fontSize: 12 }} />
                                                        <input className="form-control" placeholder="Floor %" type="number" value={form.reserveRate} onChange={set('reserveRate')} style={{ fontSize: 12 }} />
                                                        <input className="form-control" placeholder="Duration (s)" type="number" value={form.auctionDurationSecs} onChange={set('auctionDurationSecs')} style={{ fontSize: 12 }} />
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                                        <button className="btn btn-sm btn-primary" onClick={() => handleStartAuction(inv.contractId)}>🔨 Launch</button>
                                                        <button className="btn btn-sm btn-secondary" onClick={() => setShowAuctionForm(null)}>Cancel</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button className="btn btn-sm btn-primary" onClick={() => setShowAuctionForm(inv.contractId)}>
                                                    🔨 Start Auction
                                                </button>
                                            )
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {/* ─── Live Auctions ─────────────────────────────────────────── */}
            <section style={{ marginBottom: 32 }}>
                <h2 style={{ marginBottom: 12 }}>⚡ Live Auctions ({auctions.length})</h2>
                {auctions.length === 0 ? (
                    <div style={{ color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                        No open auctions visible to this party
                    </div>
                ) : (
                    auctions.map(a => (
                        <div key={a.contractId}>
                            {isBank && (
                                <div style={{ marginBottom: 8, fontSize: 12 }}>
                                    <strong>Your bank party ID for bidding:</strong>
                                    <input className="form-control mt-1" style={{ fontSize: 12 }} placeholder="Your bank party ID" value={form.bankParty} onChange={set('bankParty')} />
                                </div>
                            )}
                            <AuctionTicker
                                auction={a}
                                canBid={isBank}
                                onGrab={(rate) => handleGrab(a, rate)}
                            />
                            {(isSupplier || isOperator) && (
                                <button className="btn btn-sm btn-danger mb-3" onClick={() => cancelAuction(a.contractId)}>
                                    ✕ Cancel Auction
                                </button>
                            )}
                        </div>
                    ))
                )}

                {lastGrabResult && (
                    <div style={{ background: '#d1fae5', border: '2px solid #065f46', borderRadius: 8, padding: 16, marginTop: 12 }}>
                        <div style={{ fontWeight: 700, color: '#065f46', fontSize: 16 }}>🏆 Auction Won!</div>
                        <div style={{ fontSize: 13, marginTop: 4, color: '#064e3b' }}>
                            Purchase rate: <strong>{lastGrabResult.purchaseRate?.toFixed(2)}%</strong> ·
                            Paid to supplier: <strong>${lastGrabResult.purchaseAmount?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                        </div>
                        <div style={{ fontSize: 11, marginTop: 4, color: '#6b7280' }}>
                            ⚠️ This information is private — losing banks and the buyer cannot see this contract.
                        </div>
                    </div>
                )}
            </section>

            {/* ─── Financed Invoices (The Horses) ────────────────────────── */}
            <section style={{ marginBottom: 32 }}>
                <h2 style={{ marginBottom: 12 }}>🐎 Financed Invoices — The Race ({financedInvoices.length})</h2>
                {financedInvoices.length === 0 ? (
                    <div style={{ color: '#9ca3af', textAlign: 'center', padding: '24px 0' }}>
                        No financed invoices visible to this party
                    </div>
                ) : (
                    financedInvoices.map(fi => (
                        <div key={fi.contractId} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={{ fontWeight: 700 }}>Invoice #{fi.invoiceId}</div>
                                    <div style={{ fontSize: 13, color: '#6b7280' }}>{fi.description}</div>
                                    <div style={{ fontSize: 13 }}>
                                        Face value: <strong>${fi.amount.toLocaleString()}</strong>
                                        {isBuyer && (
                                            <span style={{ marginLeft: 12, color: '#92400e', fontSize: 12 }}>
                                                ℹ️ Bank's purchase price is confidential (Canton privacy)
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                        Bank: {fi.bank} · Supplier: {fi.supplier}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexDirection: 'column', alignItems: 'flex-end' }}>
                                    {isBuyer && fi.paymentStatus === 'ACTIVE' && (
                                        showSprintForm === fi.contractId ? (
                                            <div>
                                                <input className="form-control mb-1" type="number" placeholder="Bounty amount ($)" value={form.bountyAmount} onChange={set('bountyAmount')} style={{ fontSize: 12 }} />
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button className="btn btn-sm btn-warning" onClick={() => handleSprintBoost(fi.contractId)}>🚀 Activate</button>
                                                    <button className="btn btn-sm btn-secondary" onClick={() => setShowSprintForm(null)}>Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button className="btn btn-sm btn-warning" onClick={() => setShowSprintForm(fi.contractId)}>
                                                🚀 Sprint Boost
                                            </button>
                                        )
                                    )}
                                    {isBuyer && (fi.paymentStatus === 'ACTIVE' || fi.paymentStatus === 'SPRINT_BOOST_ACTIVE') && (
                                        <button className="btn btn-sm btn-success" onClick={() => payFinancedInvoice(fi.contractId)}>
                                            💰 Pay Now
                                        </button>
                                    )}
                                </div>
                            </div>
                            <HorseRace invoice={fi} />
                        </div>
                    ))
                )}
            </section>

            {/* ─── Bank Ownerships (PRIVATE — buyer excluded) ────────────── */}
            {(isBank || isOperator) && bankOwnerships.length > 0 && (
                <section style={{ marginBottom: 32 }}>
                    <h2 style={{ marginBottom: 4 }}>🔒 Bank Ownerships — Confidential Margin</h2>
                    <div style={{ fontSize: 13, color: '#92400e', marginBottom: 12 }}>
                        ⚠️ This data is visible ONLY to you (the bank) and the operator. The buyer and losing banks CANNOT see this.
                    </div>
                    <table className="table table-fixed" style={{ fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th>Invoice ID</th>
                                <th>Purchase Rate</th>
                                <th>Amount Paid</th>
                                <th>Face Value</th>
                                <th>Expected Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bankOwnerships.map(bo => (
                                <tr key={bo.contractId}>
                                    <td><code style={{ fontSize: 11 }}>{bo.invoiceId}</code></td>
                                    <td style={{ fontWeight: 700, color: '#065f46' }}>{bo.purchaseRate.toFixed(2)}%</td>
                                    <td>${bo.purchaseAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td>${bo.faceValue.toLocaleString()}</td>
                                    <td style={{ color: '#065f46', fontWeight: 600 }}>
                                        ${(bo.faceValue - bo.purchaseAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 4 }}>
                                            ({((bo.faceValue - bo.purchaseAmount) / bo.purchaseAmount * 100).toFixed(2)}% return)
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}

            {/* ─── Paid Invoices ─────────────────────────────────────────── */}
            {paidInvoices.length > 0 && (
                <section style={{ marginBottom: 32 }}>
                    <h2 style={{ marginBottom: 12 }}>✅ Settled Invoices ({paidInvoices.length})</h2>
                    <table className="table table-fixed" style={{ fontSize: 13 }}>
                        <thead>
                            <tr>
                                <th>Invoice ID</th>
                                <th>Amount</th>
                                <th>Sprint Boosted</th>
                                <th>Bounty Paid</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paidInvoices.map(p => (
                                <tr key={p.contractId}>
                                    <td><code style={{ fontSize: 11 }}>{p.invoiceId}</code></td>
                                    <td>${p.amount.toLocaleString()}</td>
                                    <td>{p.sprintBoosted ? '🚀 Yes' : 'No'}</td>
                                    <td>${p.bountyPaid.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}

            {/* ─── Privacy explanation footer ────────────────────────────── */}
            <section style={{ background: '#1e1b4b', color: '#c7d2fe', borderRadius: 12, padding: 20, marginTop: 32 }}>
                <h3 style={{ color: '#a5b4fc', margin: '0 0 12px' }}>🔐 How Canton Enforces Privacy</h3>
                <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                    <p style={{ margin: '0 0 8px' }}>
                        <strong style={{ color: '#e0e7ff' }}>WinningBid:</strong> Only the operator and winning bank are signatories.
                        Losing banks receive zero bytes of this contract's payload — Canton's sub-transaction protocol ensures
                        their nodes never receive the data, not merely that it's encrypted.
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                        <strong style={{ color: '#e0e7ff' }}>BankOwnership:</strong> Contains the purchase rate and margin.
                        The buyer is excluded as a signatory or observer, so they genuinely cannot see what the bank paid —
                        this is enforced at the ledger level, not just the application layer.
                    </p>
                    <p style={{ margin: 0 }}>
                        <strong style={{ color: '#e0e7ff' }}>Global Synchronizer:</strong> Only sees cryptographic commitment hashes,
                        not the business data. Neither party names, invoice amounts, nor competitive bid prices are revealed.
                    </p>
                </div>
            </section>
        </div>
    );
};

// ─── Status chip helper ──────────────────────────────────────────────────────

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
    const colors = STATUS_COLORS[status] || { bg: '#f3f4f6', fg: '#374151' };
    return (
        <span style={{
            background: colors.bg,
            color: colors.fg,
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

export default DeadlineDerbyView;
