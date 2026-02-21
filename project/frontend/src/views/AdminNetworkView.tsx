// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const F = {
    heading: "'Barlow Condensed', sans-serif",
    mono: "'Share Tech Mono', monospace",
    body: "'Barlow', sans-serif",
};

interface BankRow {
    bank: string;
    tier: string;
    certified: boolean;
    canBid: boolean;
    totalScore: number;
    reason: string;
    proofX_status: string;
    proofY_status: string;
    proofZ_status: string;
}

const TIER_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
    CERTIFIED:      { label: 'CERTIFIED',      color: 'var(--green)',  bg: 'rgba(63,185,80,0.10)',  border: 'rgba(63,185,80,0.25)' },
    PROBATIONARY:   { label: 'PROBATIONARY',   color: 'var(--amber)',  bg: 'var(--amber-bg)',       border: 'rgba(210,153,34,0.25)' },
    SUSPENDED:      { label: 'SUSPENDED',      color: 'var(--red)',    bg: 'var(--red-bg)',         border: 'rgba(232,0,45,0.25)' },
    RATE_VIOLATION: { label: 'RATE VIOLATION',  color: 'var(--red)',    bg: 'var(--red-bg)',         border: 'rgba(232,0,45,0.25)' },
};

const AdminNetworkView: React.FC = () => {
    const [banks, setBanks] = useState<BankRow[]>([]);
    const [certifiedCount, setCertifiedCount] = useState(0);
    const [networkAvgRate, setNetworkAvgRate] = useState(0);
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        try {
            const resp = await fetch('/api/trust-score/bank/all');
            if (resp.ok) {
                const data = await resp.json();
                setBanks(data.banks ?? []);
                setCertifiedCount(data.certifiedCount ?? 0);
                setNetworkAvgRate(data.networkAverageRate ?? 0);
            }
        } catch (e) {
            console.warn('admin fetch failed', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const iv = setInterval(fetchAll, 15000);
        return () => clearInterval(iv);
    }, []);

    return (
        <div style={{ background: 'var(--bg)', minHeight: '100vh', paddingTop: 16 }}>
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 14px 32px' }}>
                <div style={{ marginBottom: 14 }}>
                    <h2 style={{ margin: '0 0 2px', fontFamily: F.heading, fontWeight: 700, fontSize: 18, color: 'var(--text-1)', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>
                        CANTON NETWORK — BANK CERTIFICATION
                    </h2>
                    <p style={{ margin: 0, fontFamily: F.body, color: 'var(--text-3)', fontSize: 13 }}>
                        Synchronizer admin view. All banks on the network.
                    </p>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    <StatCard label="Total Banks" value={banks.length} color="var(--red)" />
                    <StatCard label="Certified" value={certifiedCount} color="var(--green)" />
                    <StatCard label="Avg Rate" value={networkAvgRate > 0 ? `${(networkAvgRate / 100).toFixed(2)}%` : '—'} color="var(--amber)" />
                    <StatCard label="Contributing" value={certifiedCount} color="var(--text-3)" />
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)' }}>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ fontSize: 24, display: 'inline-block' }}>◎</motion.div>
                        <div style={{ fontFamily: F.mono, fontSize: 12, marginTop: 6 }}>Loading bank data...</div>
                    </div>
                ) : banks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, fontFamily: F.body, color: 'var(--text-3)', fontSize: 13 }}>
                        No banks registered yet.
                    </div>
                ) : (
                    <div style={{ border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 150px 60px 100px',
                            padding: '8px 14px', background: 'var(--surface2)',
                            fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700,
                            color: 'var(--text-3)', textTransform: 'uppercase' as const,
                            letterSpacing: '2.5px',
                        }}>
                            <span>Bank</span><span>Tier</span><span>Score</span><span>Status</span>
                        </div>
                        <AnimatePresence>
                            {banks.map((b) => {
                                const t = TIER_CFG[b.tier] ?? TIER_CFG.SUSPENDED;
                                return (
                                    <div
                                        key={b.bank}
                                        style={{
                                            display: 'grid', gridTemplateColumns: '1fr 150px 60px 100px',
                                            padding: '10px 14px', borderTop: '1px solid var(--border)',
                                            alignItems: 'center', fontSize: 13,
                                            background: 'var(--surface)',
                                        }}
                                    >
                                        <span style={{ fontFamily: F.body, fontWeight: 600, color: 'var(--text-1)' }}>{b.bank}</span>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '2px 7px',
                                            background: t.bg, color: t.color,
                                            border: `1px solid ${t.border}`,
                                            fontFamily: F.heading, fontWeight: 700,
                                            fontSize: '0.65rem',
                                            textTransform: 'uppercase' as const,
                                            letterSpacing: '1px',
                                            width: 'fit-content',
                                        }}>
                                            {t.label}
                                        </span>
                                        <span style={{ fontFamily: F.mono, fontWeight: 700, color: 'var(--text-1)', fontSize: 12 }}>{b.totalScore}/3</span>
                                        <span style={{
                                            fontFamily: F.heading, fontSize: 11, fontWeight: 700,
                                            color: b.canBid ? 'var(--green)' : 'var(--red)',
                                            textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                                        }}>
                                            {b.canBid ? 'CAN BID' : 'DISABLED'}
                                        </span>
                                    </div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; color: string }> = ({ label, value, color }) => (
    <div style={{
        flex: 1, minWidth: 100,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        padding: '10px 14px',
    }}>
        <div style={{ fontFamily: F.heading, fontSize: '0.59rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '2.5px', marginBottom: 2 }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontSize: 20, fontWeight: 900, color }}>{value}</div>
    </div>
);

export default AdminNetworkView;
