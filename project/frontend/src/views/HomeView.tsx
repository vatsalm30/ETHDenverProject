// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect } from 'react';
import { useUserStore } from '../stores/userStore';
import { useNavigate, Link } from 'react-router-dom';

const F = {
    heading: "'Barlow Condensed', sans-serif",
    mono: "'Share Tech Mono', monospace",
    body: "'Barlow', sans-serif",
};

const HomeView: React.FC = () => {
    const { user, loading } = useUserStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && user !== null) {
            navigate('/dashboard');
        }
    }, [user, loading, navigate]);

    if (loading || user !== null) return null;

    return (
        <div style={{
            minHeight: 'calc(100vh - 82px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px 20px',
        }}>
            <div style={{ maxWidth: 560, width: '100%' }}>

                {/* Accent line */}
                <div style={{ width: 48, height: 2, background: 'var(--red)', marginBottom: 20 }} />

                {/* Title */}
                <h1 style={{
                    fontFamily: F.heading,
                    fontSize: 'clamp(28px, 5vw, 42px)',
                    fontWeight: 900,
                    color: 'var(--text-1)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '2px',
                    lineHeight: 1.1,
                    margin: '0 0 10px',
                }}>
                    Invoice Now
                </h1>

                {/* Subtitle */}
                <p style={{
                    fontFamily: F.body,
                    fontSize: 15,
                    color: 'var(--text-2)',
                    lineHeight: 1.6,
                    margin: '0 0 28px',
                    maxWidth: 440,
                }}>
                    Decentralized invoice financing on the Canton Network.
                    Submit receivables, run sealed-bid auctions, and settle
                    with ZK-verified trust scores.
                </p>

                {/* Feature list */}
                <div style={{ marginBottom: 32 }}>
                    {[
                        { label: 'ZK TRUST', desc: 'Privacy-preserving creditworthiness proofs' },
                        { label: 'SEALED BID', desc: 'Confidential auction mechanism for fair pricing' },
                        { label: 'CANTON', desc: 'Atomic settlement on the Global Synchronizer' },
                    ].map((item, i) => (
                        <div key={i} style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 12,
                            padding: '8px 0',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            <span style={{
                                fontFamily: F.mono,
                                fontSize: 10,
                                color: 'var(--teal)',
                                flexShrink: 0,
                                width: 80,
                            }}>
                                {item.label}
                            </span>
                            <span style={{
                                fontFamily: F.body,
                                fontSize: 13,
                                color: 'var(--text-3)',
                            }}>
                                {item.desc}
                            </span>
                        </div>
                    ))}
                </div>

                {/* CTA */}
                <Link
                    to="/select-role"
                    style={{
                        display: 'inline-block',
                        padding: '10px 24px',
                        background: 'var(--red)',
                        color: '#fff',
                        textDecoration: 'none',
                        fontFamily: F.heading,
                        fontWeight: 700,
                        fontSize: 13,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '1.5px',
                    }}
                >
                    GET STARTED
                </Link>

                {/* Footer note */}
                <p style={{
                    fontFamily: F.mono,
                    fontSize: '0.59rem',
                    color: 'var(--text-3)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '2px',
                    marginTop: 32,
                }}>
                    Built at ETHDenver 2026 · Powered by Daml + Canton
                </p>
            </div>
        </div>
    );
};

export default HomeView;
