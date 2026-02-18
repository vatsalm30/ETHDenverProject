// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useState } from 'react';
import { useToast } from '../stores/toastStore';
import api from '../api';
import { Client, LoginLink, FeatureFlags } from '../openapi';

// Which "intent" the user clicked before hitting login
type SignupIntent = 'company' | 'institution' | null;

const LoginView: React.FC = () => {
    const [loginLinks, setLoginLinks] = useState<LoginLink[]>([]);
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
    const [intent, setIntent] = useState<SignupIntent>(null);
    const toast = useToast();

    useEffect(() => {
        const init = async () => {
            try {
                const client: Client = await api.getClient();
                const ff = await client.getFeatureFlags();
                setFeatureFlags(ff.data);
                if (ff.data.authMode === 'oauth2') {
                    const links = await client.listLinks();
                    setLoginLinks(links.data);
                }
            } catch {
                toast.displayError('Error loading login options');
            }
        };
        init();
    }, []);

    const isOAuth2 = featureFlags?.authMode === 'oauth2';

    // ── Landing / choose role ──────────────────────────────────────────────────

    if (!intent) {
        return (
            <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {/* Hero */}
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <div style={{ fontSize: 56, marginBottom: 12 }}>🏇</div>
                    <h1 style={{ fontSize: 36, fontWeight: 900, margin: '0 0 10px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Deadline Derby
                    </h1>
                    <p style={{ fontSize: 18, color: '#6b7280', margin: '0 0 6px' }}>
                        Confidential Invoice Financing on Canton Network
                    </p>
                    <p style={{ fontSize: 14, color: '#9ca3af', maxWidth: 420, margin: '0 auto' }}>
                        Companies get paid early. Institutions earn yield. Privacy enforced at the ledger level.
                    </p>
                </div>

                {/* Role cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 640, width: '90%', marginBottom: 40 }}>
                    {/* Company card */}
                    <button
                        onClick={() => setIntent('company')}
                        style={{ background: '#fff', border: '2px solid #e5e7eb', borderRadius: 16, padding: 28, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#4f46e5'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(79,70,229,0.15)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; }}
                    >
                        <div style={{ fontSize: 40, marginBottom: 12 }}>🏭</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>I'm a Company</div>
                        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                            Upload invoices, request early payment, set your financing terms
                        </div>
                        <div style={{ marginTop: 16, padding: '10px 0', background: '#4f46e5', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
                            Sign Up / Log In →
                        </div>
                    </button>

                    {/* Institution card */}
                    <button
                        onClick={() => setIntent('institution')}
                        style={{ background: '#fff', border: '2px solid #e5e7eb', borderRadius: 16, padding: 28, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#065f46'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 24px rgba(6,95,70,0.15)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'; }}
                    >
                        <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>I'm an Institution</div>
                        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                            Browse businesses seeking financing, place bids, earn yield on funded invoices
                        </div>
                        <div style={{ marginTop: 16, padding: '10px 0', background: '#065f46', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
                            Sign Up / Log In →
                        </div>
                    </button>
                </div>

                {/* How it works */}
                <div style={{ maxWidth: 640, width: '90%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 }}>How it works</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        {[
                            { icon: '📤', title: 'Upload', text: 'Company uploads invoice, AI parser fills the form' },
                            { icon: '⚡', title: 'Auction', text: 'Dutch auction — rate falls until an institution bids' },
                            { icon: '💰', title: 'Settle', text: 'Company gets paid early. Institution earns at maturity' },
                        ].map(({ icon, title, text }) => (
                            <div key={title} style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 24 }}>{icon}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', margin: '6px 0 4px' }}>{title}</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>{text}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ── OAuth2 login links ────────────────────────────────────────────────────

    const accentColor = intent === 'company' ? '#4f46e5' : '#065f46';
    const roleIcon = intent === 'company' ? '🏭' : '🏦';
    const roleTitle = intent === 'company' ? 'Company' : 'Institution';

    if (isOAuth2) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <button onClick={() => setIntent(null)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
                    ← Back
                </button>
                <div style={{ background: '#fff', border: `2px solid ${accentColor}33`, borderRadius: 16, padding: 36, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>{roleIcon}</div>
                    <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>Sign in as {roleTitle}</h2>
                    <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
                        Choose your account to continue
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {loginLinks.map(link => (
                            <a
                                key={link.url}
                                href={link.url}
                                style={{ display: 'block', padding: '13px 20px', background: accentColor, color: '#fff', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 15 }}
                            >
                                {link.name} →
                            </a>
                        ))}
                    </div>
                    <div style={{ marginTop: 20, padding: '12px 16px', background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280', textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Demo credentials</div>
                        <div>App Provider: <code>app-provider</code> / <code>abc123</code></div>
                        <div>App User: <code>app-user</code> / <code>abc123</code></div>
                        <div style={{ marginTop: 6, color: '#9ca3af', fontSize: 11 }}>
                            After login, you'll set up your Company or Institution profile in-app.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Shared-secret login ───────────────────────────────────────────────────

    return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <button onClick={() => setIntent(null)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, marginBottom: 24 }}>
                ← Back
            </button>
            <div style={{ background: '#fff', border: `2px solid ${accentColor}33`, borderRadius: 16, padding: 36, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>{roleIcon}</div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>Sign in as {roleTitle}</h2>
                <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Enter your username to continue</p>
                <form name="f" action="login/shared-secret" method="POST">
                    <input type="hidden" name="intent" value={intent} />
                    <div style={{ marginBottom: 16, textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Username</label>
                        <input
                            type="text"
                            name="username"
                            autoFocus
                            style={{ width: '100%', padding: '12px 14px', border: `2px solid ${accentColor}55`, borderRadius: 8, fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                            placeholder="app-provider or app-user"
                        />
                    </div>
                    <button
                        type="submit"
                        style={{ width: '100%', padding: '13px 0', background: accentColor, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
                    >
                        Sign In →
                    </button>
                </form>
                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280', textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Demo accounts</div>
                    <div>App Provider: <code>app-provider</code></div>
                    <div>App User: <code>app-user</code></div>
                </div>
            </div>
        </div>
    );
};

export default LoginView;
