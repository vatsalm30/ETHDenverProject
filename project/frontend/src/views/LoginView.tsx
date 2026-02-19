// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '../stores/toastStore';
import { useProfile } from '../stores/profileStore';
import api from '../api';
import { Client, LoginLink, FeatureFlags } from '../openapi';

type RoleIntent = 'company' | 'institution';
type Screen = 'landing' | 'role-chosen' | 'signup';

const SECTORS = [
    'Agriculture', 'Construction', 'Education', 'Energy', 'Finance',
    'Healthcare', 'Hospitality', 'Legal', 'Logistics', 'Manufacturing',
    'Media', 'Real Estate', 'Retail', 'Technology', 'Telecommunications',
    'Transportation', 'Other',
];

const LoginView: React.FC = () => {
    const [screen, setScreen] = useState<Screen>('landing');
    const [intent, setIntent] = useState<RoleIntent>('company');
    const [loginLinks, setLoginLinks] = useState<LoginLink[]>([]);
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
    const [loading, setLoading] = useState(false);

    // Signup form state
    const [signupUsername, setSignupUsername] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupDisplayName, setSignupDisplayName] = useState('');
    const [signupSector, setSignupSector] = useState('Technology');

    const loginFormRef = useRef<HTMLFormElement>(null);
    const loginUsernameRef = useRef<HTMLInputElement>(null);
    const loginPasswordRef = useRef<HTMLInputElement>(null);

    const toast = useToast();
    const { register } = useProfile();

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

    const handleRoleClick = (role: RoleIntent) => {
        setIntent(role);
        setScreen('role-chosen');
    };

    const handleSignupSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!signupUsername.trim() || !signupDisplayName.trim()) {
            toast.displayError('Username and display name are required');
            return;
        }
        setLoading(true);
        try {
            await register({
                username: signupUsername.trim().toLowerCase(),
                password: signupPassword || 'password',
                displayName: signupDisplayName.trim(),
                type: intent === 'company' ? 'COMPANY' : 'INSTITUTION',
                sector: signupSector || undefined,
            });
            toast.displaySuccess('Account created! Logging you in…');
            // Auto-login: programmatically submit the Spring Security form
            if (loginUsernameRef.current) loginUsernameRef.current.value = signupUsername.trim().toLowerCase();
            if (loginPasswordRef.current) loginPasswordRef.current.value = signupPassword || 'password';
            loginFormRef.current?.submit();
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err?.message ?? 'Registration failed';
            toast.displayError(msg);
            setLoading(false);
        }
    };

    const accentColor = intent === 'company' ? '#4f46e5' : '#065f46';
    const roleIcon = intent === 'company' ? '🏭' : '🏦';
    const roleTitle = intent === 'company' ? 'Company' : 'Institution';

    // ── Landing ──────────────────────────────────────────────────────────────

    if (screen === 'landing') {
        return (
            <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {/* Hero */}
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <div style={{ fontSize: 52, marginBottom: 10 }}>⚡</div>
                    <h1 style={{ fontSize: 36, fontWeight: 900, margin: '0 0 10px', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        Canton Invoice Finance
                    </h1>
                    <p style={{ fontSize: 18, color: '#6b7280', margin: '0 0 6px' }}>
                        Confidential Invoice Financing on Canton Network
                    </p>
                    <p style={{ fontSize: 14, color: '#9ca3af', maxWidth: 440, margin: '0 auto' }}>
                        Companies get paid early. Institutions earn yield. Privacy enforced at the ledger level.
                    </p>
                </div>

                {/* Role cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 640, width: '90%', marginBottom: 40 }}>
                    <RoleCard
                        icon="🏭"
                        title="I'm a Company"
                        description="Upload invoices, launch sealed-bid auctions, and get paid early"
                        accentColor="#4f46e5"
                        onClick={() => handleRoleClick('company')}
                    />
                    <RoleCard
                        icon="🏦"
                        title="I'm an Institution"
                        description="Browse auctions, place confidential bids, and earn yield on funded invoices"
                        accentColor="#065f46"
                        onClick={() => handleRoleClick('institution')}
                    />
                </div>

                {/* How it works */}
                <div style={{ maxWidth: 640, width: '90%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 }}>How it works</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        {[
                            { icon: '📤', title: 'Upload', text: 'Company uploads invoice — AI parser fills the form' },
                            { icon: '🔒', title: 'Bid', text: 'Sealed bids from institutions — lowest rate wins at close' },
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

    // ── Role chosen — login or sign up ────────────────────────────────────────

    if (screen === 'signup') {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {/* Hidden auto-login form submitted after registration */}
                <form ref={loginFormRef} method="POST" action="/login/shared-secret" style={{ display: 'none' }}>
                    <input ref={loginUsernameRef} type="text" name="username" />
                    <input ref={loginPasswordRef} type="password" name="password" />
                </form>

                <button onClick={() => setScreen('role-chosen')} style={backBtnStyle}>← Back</button>
                <div style={{ background: '#fff', border: `2px solid ${accentColor}33`, borderRadius: 16, padding: 36, maxWidth: 460, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>{roleIcon}</div>
                    <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, textAlign: 'center' }}>Create {roleTitle} Account</h2>
                    <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>Join Canton Invoice Finance</p>

                    <form onSubmit={handleSignupSubmit}>
                        <Field label="Username *" hint="Lowercase letters, digits, - and _ only">
                            <input
                                type="text"
                                value={signupUsername}
                                onChange={e => setSignupUsername(e.target.value)}
                                placeholder={intent === 'company' ? 'acme-corp' : 'first-capital-bank'}
                                style={inputStyle(accentColor)}
                                autoFocus
                            />
                        </Field>
                        <Field label="Password" hint="Leave blank for demo default">
                            <input
                                type="password"
                                value={signupPassword}
                                onChange={e => setSignupPassword(e.target.value)}
                                placeholder="Choose a password (optional for demo)"
                                style={inputStyle(accentColor)}
                            />
                        </Field>
                        <Field label={intent === 'company' ? 'Company Name *' : 'Institution Name *'}>
                            <input
                                type="text"
                                value={signupDisplayName}
                                onChange={e => setSignupDisplayName(e.target.value)}
                                placeholder={intent === 'company' ? 'Acme Manufacturing Corp' : 'First Capital Bank'}
                                style={inputStyle(accentColor)}
                            />
                        </Field>
                        <Field label="Sector">
                            <select
                                value={signupSector}
                                onChange={e => setSignupSector(e.target.value)}
                                style={{ ...inputStyle(accentColor), cursor: 'pointer' }}
                            >
                                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </Field>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{ width: '100%', padding: '13px 0', background: loading ? '#a5b4fc' : accentColor, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: loading ? 'wait' : 'pointer', marginTop: 8 }}
                        >
                            {loading ? 'Creating account…' : `Create ${roleTitle} Account →`}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ── Role chosen — show login + sign up options ────────────────────────────

    if (isOAuth2) {
        return (
            <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <button onClick={() => setScreen('landing')} style={backBtnStyle}>← Back</button>
                <div style={{ background: '#fff', border: `2px solid ${accentColor}33`, borderRadius: 16, padding: 36, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                    <div style={{ fontSize: 44, marginBottom: 12 }}>{roleIcon}</div>
                    <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>Sign in as {roleTitle}</h2>
                    <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>Choose your account to continue</p>
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
                    <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>
                        After login you'll set up your profile in the dashboard.
                    </div>
                </div>
            </div>
        );
    }

    // Shared-secret mode: show login + sign up choice
    return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <button onClick={() => setScreen('landing')} style={backBtnStyle}>← Back</button>
            <div style={{ background: '#fff', border: `2px solid ${accentColor}33`, borderRadius: 16, padding: 36, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.08)', textAlign: 'center' }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>{roleIcon}</div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>Sign in as {roleTitle}</h2>
                <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>Enter your credentials to continue</p>

                {/* Existing login form */}
                <form name="f" action="/login/shared-secret" method="POST">
                    <input type="hidden" name="intent" value={intent} />
                    <div style={{ marginBottom: 12, textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Username</label>
                        <input
                            type="text"
                            name="username"
                            autoFocus
                            style={inputStyle(accentColor)}
                            placeholder="your-username"
                        />
                    </div>
                    <div style={{ marginBottom: 16, textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password</label>
                        <input
                            type="password"
                            name="password"
                            style={inputStyle(accentColor)}
                            placeholder="your-password"
                        />
                    </div>
                    <button
                        type="submit"
                        style={{ width: '100%', padding: '13px 0', background: accentColor, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
                    >
                        Sign In →
                    </button>
                </form>

                <div style={{ margin: '20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                    <span style={{ fontSize: 13, color: '#9ca3af' }}>or</span>
                    <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
                </div>

                <button
                    onClick={() => setScreen('signup')}
                    style={{ width: '100%', padding: '13px 0', background: '#f9fafb', color: accentColor, border: `2px solid ${accentColor}`, borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                >
                    New here? Create an account
                </button>

                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#6b7280', textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Demo accounts</div>
                    <div>Company: <code>app-provider</code> / <code>abc123</code></div>
                    <div>Institution: <code>app-user</code> / <code>abc123</code></div>
                </div>
            </div>
        </div>
    );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const RoleCard: React.FC<{
    icon: string;
    title: string;
    description: string;
    accentColor: string;
    onClick: () => void;
}> = ({ icon, title, description, accentColor, onClick }) => {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: '#fff',
                border: `2px solid ${hovered ? accentColor : '#e5e7eb'}`,
                borderRadius: 16,
                padding: 28,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: hovered ? `0 8px 24px ${accentColor}25` : '0 2px 12px rgba(0,0,0,0.06)',
            }}
        >
            <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1f2937', marginBottom: 8 }}>{title}</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{description}</div>
            <div style={{ marginTop: 16, padding: '10px 0', background: accentColor, color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
                Sign Up / Log In →
            </div>
        </button>
    );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div style={{ marginBottom: 14, textAlign: 'left' }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            {label}
        </label>
        {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>{hint}</div>}
        {children}
    </div>
);

const backBtnStyle: React.CSSProperties = {
    alignSelf: 'flex-start',
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 14,
    marginBottom: 24,
};

const inputStyle = (accentColor: string): React.CSSProperties => ({
    width: '100%',
    padding: '10px 14px',
    border: `2px solid ${accentColor}44`,
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
});

export default LoginView;
