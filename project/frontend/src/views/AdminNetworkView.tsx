// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const C = {
    primary: '#FF4B6E', text: '#1E293B', muted: '#94A3B8', border: '#F1F5F9',
    green: '#10B981', gold: '#F59E0B', bg: '#FFFFFF',
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

const TIER_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    CERTIFIED:      { label: 'CERTIFIED',      color: '#065f46', bg: '#D1FAE5', icon: '✓' },
    PROBATIONARY:   { label: 'PROBATIONARY',   color: '#92400e', bg: '#FEF3C7', icon: '⏳' },
    SUSPENDED:      { label: 'SUSPENDED',      color: '#991b1b', bg: '#FEE2E2', icon: '✗' },
    RATE_VIOLATION: { label: 'RATE VIOLATION',  color: '#7c2d12', bg: '#FED7AA', icon: '⚠' },
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
        <div style={{ background: 'linear-gradient(160deg, #F0F9FF 0%, #E0F2FE 40%, #F0FDF4 100%)', minHeight: '100vh', paddingTop: 24 }}>
            <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px 40px' }}>
                <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
                    <h2 style={{ margin: '0 0 6px', fontWeight: 900, fontSize: 22, color: C.text }}>
                        Canton Network — Bank Certification Status
                    </h2>
                    <p style={{ margin: '0 0 20px', color: C.muted, fontSize: 14 }}>
                        Synchronizer admin view. All banks on the network.
                    </p>
                </motion.div>

                {/* Summary row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                    <StatCard label="Total Banks" value={banks.length} color="#6366f1" />
                    <StatCard label="Certified" value={certifiedCount} color={C.green} />
                    <StatCard label="Avg Rate" value={networkAvgRate > 0 ? `${(networkAvgRate / 100).toFixed(2)}%` : '—'} color={C.gold} />
                    <StatCard label="Contributing to Avg" value={certifiedCount} color={C.muted} />
                </div>

                {/* Bank table */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ fontSize: 32, display: 'inline-block' }}>🏦</motion.div>
                        <div style={{ marginTop: 8 }}>Loading bank data...</div>
                    </div>
                ) : banks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
                        No banks registered yet.
                    </div>
                ) : (
                    <div style={{ background: C.bg, borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 160px 60px 100px',
                            padding: '12px 20px', background: '#F8FAFC',
                            fontSize: 11, fontWeight: 800, color: C.muted, textTransform: 'uppercase' as const,
                        }}>
                            <span>Bank</span><span>Tier</span><span>Score</span><span>Status</span>
                        </div>
                        <AnimatePresence>
                            {banks.map((b, i) => {
                                const t = TIER_CFG[b.tier] ?? TIER_CFG.SUSPENDED;
                                return (
                                    <motion.div
                                        key={b.bank}
                                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.04 }}
                                        style={{
                                            display: 'grid', gridTemplateColumns: '1fr 160px 60px 100px',
                                            padding: '14px 20px', borderTop: `1px solid ${C.border}`,
                                            alignItems: 'center', fontSize: 13,
                                        }}
                                    >
                                        <span style={{ fontWeight: 700, color: C.text }}>{b.bank}</span>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            padding: '3px 10px', borderRadius: 999,
                                            background: t.bg, color: t.color,
                                            fontWeight: 800, fontSize: 11, width: 'fit-content',
                                        }}>
                                            {t.icon} {t.label}
                                        </span>
                                        <span style={{ fontWeight: 800, color: C.text }}>{b.totalScore}/3</span>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: b.canBid ? C.green : '#991b1b' }}>
                                            {b.canBid ? 'Can bid ✓' : 'Bidding disabled'}
                                        </span>
                                    </motion.div>
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
        flex: 1, minWidth: 120, background: '#FFFFFF', borderRadius: 14,
        padding: '16px 18px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        border: '1px solid #F1F5F9',
    }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' as const, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
    </div>
);

export default AdminNetworkView;
