// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../stores/toastStore';
import { useProfile } from '../stores/profileStore';
import api from '../api';
import { Client, LoginLink, FeatureFlags } from '../openapi';

const SECTORS = [
    'Agriculture', 'Construction', 'Education', 'Energy', 'Finance',
    'Healthcare', 'Hospitality', 'Legal', 'Logistics', 'Manufacturing',
    'Media', 'Real Estate', 'Retail', 'Technology', 'Telecommunications',
    'Transportation', 'Other',
];

const F = {
    heading: "'Barlow Condensed', sans-serif",
    mono: "'Share Tech Mono', monospace",
    body: "'Barlow', sans-serif",
};

type Screen = 'login' | 'signup';

const LoginView: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { register } = useProfile();

    const storedRole = (
        localStorage.getItem('user-role') ??
        localStorage.getItem('cupid-role')
    ) as 'COMPANY' | 'INSTITUTION' | null;
    const role: 'COMPANY' | 'INSTITUTION' = storedRole ?? 'COMPANY';
    const isCompany = role === 'COMPANY';

    const [screen, setScreen] = useState<Screen>('login');
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
    const [loginLinks, setLoginLinks] = useState<LoginLink[]>([]);
    const [loading, setLoading] = useState(false);

    const [signupUsername, setSignupUsername] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupDisplayName, setSignupDisplayName] = useState('');
    const [signupSector, setSignupSector] = useState('Technology');

    const loginFormRef = useRef<HTMLFormElement>(null);
    const loginUsernameRef = useRef<HTMLInputElement>(null);
    const loginPasswordRef = useRef<HTMLInputElement>(null);

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
    const accent = isCompany ? 'var(--red)' : 'var(--amber)';
    const roleLabel = isCompany ? 'Company' : 'Institution';

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
                type: role,
                sector: signupSector || undefined,
            });
            toast.displaySuccess('Account created! Logging you in…');
            if (loginUsernameRef.current) loginUsernameRef.current.value = signupUsername.trim().toLowerCase();
            if (loginPasswordRef.current) loginPasswordRef.current.value = signupPassword || 'password';
            loginFormRef.current?.submit();
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err?.message ?? 'Registration failed';
            toast.displayError(msg);
            setLoading(false);
        }
    };

    if (isOAuth2) {
        return (
            <PageShell>
                <TerminalCard>
                    <RoleHeader label={roleLabel} accent={accent} />
                    <p style={{ textAlign: 'center', color: 'var(--text-2)', fontFamily: F.body, fontSize: 13, marginBottom: 16 }}>
                        Sign in with your {roleLabel} account
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {loginLinks.map(link => (
                            <a
                                key={link.url}
                                href={link.url}
                                style={{
                                    display: 'block', padding: '10px 16px',
                                    background: accent, color: '#fff',
                                    textDecoration: 'none',
                                    fontFamily: F.heading, fontWeight: 700, fontSize: 13,
                                    textAlign: 'center', textTransform: 'uppercase' as const,
                                    letterSpacing: '1.5px',
                                }}
                            >
                                {link.name}
                            </a>
                        ))}
                    </div>
                    {loginLinks.some(l => l.registrationUrl) && (
                        <>
                            <Divider />
                            {loginLinks.map(link => link.registrationUrl && (
                                <a
                                    key={link.registrationUrl}
                                    href={link.registrationUrl}
                                    style={{
                                        display: 'block', padding: '10px 16px',
                                        background: 'transparent', color: accent,
                                        border: `1px solid ${accent}`,
                                        textDecoration: 'none',
                                        fontFamily: F.heading, fontWeight: 700, fontSize: 13,
                                        textAlign: 'center', textTransform: 'uppercase' as const,
                                        letterSpacing: '1.5px',
                                    }}
                                >
                                    CREATE KEYCLOAK ACCOUNT
                                </a>
                            ))}
                        </>
                    )}
                    <BackLink onClick={() => navigate('/select-role')} />
                </TerminalCard>
            </PageShell>
        );
    }

    if (screen === 'signup') {
        return (
            <PageShell>
                <form ref={loginFormRef} method="POST" action="/login/shared-secret" style={{ display: 'none' }}>
                    <input ref={loginUsernameRef} type="text" name="username" />
                    <input ref={loginPasswordRef} type="password" name="password" />
                </form>

                <TerminalCard>
                    <RoleHeader label={`Create ${roleLabel} Account`} accent={accent} />
                    <form onSubmit={handleSignupSubmit}>
                        <Field label="Username *" hint="Lowercase letters, digits, - and _ only">
                            <FormInput
                                value={signupUsername}
                                onChange={e => setSignupUsername(e.target.value)}
                                placeholder={isCompany ? 'acme-corp' : 'first-capital-bank'}
                                autoFocus
                            />
                        </Field>
                        <Field label="Password" hint="Leave blank for demo default">
                            <FormInput
                                type="password"
                                value={signupPassword}
                                onChange={e => setSignupPassword(e.target.value)}
                                placeholder="Choose a password (optional)"
                            />
                        </Field>
                        <Field label={isCompany ? 'Company Name *' : 'Institution Name *'}>
                            <FormInput
                                value={signupDisplayName}
                                onChange={e => setSignupDisplayName(e.target.value)}
                                placeholder={isCompany ? 'Acme Manufacturing Corp' : 'First Capital Bank'}
                            />
                        </Field>
                        <Field label="Sector">
                            <select
                                value={signupSector}
                                onChange={e => setSignupSector(e.target.value)}
                                style={inputBase}
                            >
                                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </Field>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%', padding: '10px 0', marginTop: 6,
                                background: loading ? 'var(--surface3)' : accent,
                                color: loading ? 'var(--text-3)' : '#fff',
                                border: 'none',
                                fontFamily: F.heading, fontWeight: 700, fontSize: 13,
                                textTransform: 'uppercase' as const, letterSpacing: '1.5px',
                                cursor: loading ? 'wait' : 'pointer',
                            }}
                        >
                            {loading ? 'CREATING ACCOUNT…' : `CREATE ${roleLabel.toUpperCase()} ACCOUNT`}
                        </button>
                    </form>
                    <Divider />
                    <button
                        onClick={() => setScreen('login')}
                        style={ghostBtn(accent)}
                    >
                        ALREADY HAVE AN ACCOUNT? SIGN IN
                    </button>
                    <BackLink onClick={() => navigate('/select-role')} />
                </TerminalCard>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <TerminalCard>
                <RoleHeader label={`Sign in as ${roleLabel}`} accent={accent} />
                <p style={{ textAlign: 'center', color: 'var(--text-2)', fontFamily: F.body, fontSize: 13, marginBottom: 16 }}>
                    Enter your credentials to continue
                </p>

                <form name="f" action="/login/shared-secret" method="POST">
                    <input type="hidden" name="intent" value={role.toLowerCase()} />
                    <Field label="Username">
                        <FormInput name="username" placeholder="your-username" autoFocus />
                    </Field>
                    <Field label="Password">
                        <FormInput name="password" type="password" placeholder="your-password" />
                    </Field>
                    <button
                        type="submit"
                        style={{
                            width: '100%', padding: '10px 0', marginTop: 4,
                            background: accent, color: '#fff', border: 'none',
                            fontFamily: F.heading, fontWeight: 700, fontSize: 13,
                            textTransform: 'uppercase' as const, letterSpacing: '1.5px',
                            cursor: 'pointer',
                        }}
                    >
                        SIGN IN
                    </button>
                </form>

                <div style={{ marginTop: 10, background: 'var(--surface2)', border: '1px solid var(--border)', padding: '8px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                    <strong style={{ display: 'block', marginBottom: 4, color: 'var(--text-1)', fontFamily: F.heading, textTransform: 'uppercase' as const, letterSpacing: '1px', fontSize: 11 }}>DEMO ACCOUNTS</strong>
                    <div style={{ fontFamily: F.mono, fontSize: 11 }}>Company: <span style={{ color: 'var(--teal)' }}>app-provider</span> / <span style={{ color: 'var(--teal)' }}>abc123</span></div>
                    <div style={{ fontFamily: F.mono, fontSize: 11 }}>Institution: <span style={{ color: 'var(--teal)' }}>app-user</span> / <span style={{ color: 'var(--teal)' }}>abc123</span></div>
                </div>

                <Divider />
                <button
                    onClick={() => setScreen('signup')}
                    style={ghostBtn(accent)}
                >
                    CREATE A {roleLabel.toUpperCase()} ACCOUNT
                </button>
                <BackLink onClick={() => navigate('/select-role')} />
            </TerminalCard>
        </PageShell>
    );
};

// ─── Sub-components ───────────────────────────────────────────────────────

const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px 16px',
    }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
            {children}
        </div>
    </div>
);

const TerminalCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        padding: '24px 20px',
    }}>
        {children}
    </div>
);

const RoleHeader: React.FC<{ label: string; accent: string }> = ({ label, accent }) => (
    <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{
            width: 40, height: 3, background: accent,
            margin: '0 auto 12px',
        }} />
        <h2 style={{
            margin: 0, fontFamily: F.heading, fontSize: 18, fontWeight: 700,
            color: 'var(--text-1)', textTransform: 'uppercase' as const,
            letterSpacing: '1px',
        }}>
            {label}
        </h2>
    </div>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div style={{ marginBottom: 10, textAlign: 'left' }}>
        <label style={{
            display: 'block', fontFamily: F.heading, fontSize: '0.59rem',
            fontWeight: 700, color: 'var(--text-3)', marginBottom: 4,
            textTransform: 'uppercase' as const, letterSpacing: '2.5px',
        }}>
            {label}
        </label>
        {hint && <div style={{ fontFamily: F.body, fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{hint}</div>}
        {children}
    </div>
);

const inputBase: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    border: '1px solid var(--border2)',
    fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
    background: 'var(--surface2)',
    color: 'var(--text-1)',
    fontFamily: "'Share Tech Mono', monospace",
};

const FormInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
    <input
        {...props}
        style={inputBase}
        onFocus={e => { e.target.style.borderColor = 'var(--teal)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border2)'; }}
    />
);

const Divider = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontFamily: F.heading, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
);

const ghostBtn = (accent: string): React.CSSProperties => ({
    width: '100%', padding: '10px 0',
    background: 'transparent',
    color: accent,
    border: `1px solid ${accent}`,
    fontFamily: F.heading, fontWeight: 700, fontSize: 12,
    textTransform: 'uppercase' as const, letterSpacing: '1.5px',
    cursor: 'pointer',
});

const BackLink: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        style={{
            display: 'block', width: '100%', marginTop: 12,
            background: 'none', border: 'none',
            color: 'var(--text-3)', cursor: 'pointer',
            fontFamily: F.heading, fontSize: 11,
            textTransform: 'uppercase' as const, letterSpacing: '1px',
            textAlign: 'center',
        }}
    >
        CHANGE ROLE
    </button>
);

export default LoginView;
