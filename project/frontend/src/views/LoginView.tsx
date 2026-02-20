// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
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

type Screen = 'login' | 'signup';

const LoginView: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { register } = useProfile();

    // Role comes from the SelectRoleView — fall back to COMPANY
    const storedRole = localStorage.getItem('cupid-role') as 'COMPANY' | 'INSTITUTION' | null;
    const role: 'COMPANY' | 'INSTITUTION' = storedRole ?? 'COMPANY';
    const isCompany = role === 'COMPANY';

    const [screen, setScreen] = useState<Screen>('login');
    const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
    const [loginLinks, setLoginLinks] = useState<LoginLink[]>([]);
    const [loading, setLoading] = useState(false);

    // Signup form
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
    const accent = isCompany ? '#FF4B6E' : '#C9956C';
    const roleIcon = isCompany ? '🏭' : '🏦';
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

    // ── Shared-secret OAuth2 mode ─────────────────────────────────────────

    if (isOAuth2) {
        return (
            <PageShell>
                <GlassCard accent={accent}>
                    <RoleHeader icon={roleIcon} label={roleLabel} accent={accent} />
                    <p style={{ textAlign: 'center', color: '#9E6B7D', fontSize: 14, marginBottom: 24 }}>
                        Sign in with your {roleLabel} account
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {loginLinks.map(link => (
                            <motion.a
                                key={link.url}
                                href={link.url}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                style={{
                                    display: 'block', padding: '14px 20px',
                                    background: accent, color: '#fff',
                                    borderRadius: 12, textDecoration: 'none',
                                    fontWeight: 800, fontSize: 15, textAlign: 'center',
                                    boxShadow: `0 4px 18px ${accent}50`,
                                }}
                            >
                                {link.name} →
                            </motion.a>
                        ))}
                    </div>
                    {loginLinks.some(l => l.registrationUrl) && (
                        <>
                            <Divider />
                            {loginLinks.map(link => link.registrationUrl && (
                                <motion.a
                                    key={link.registrationUrl}
                                    href={link.registrationUrl}
                                    whileHover={{ scale: 1.02 }}
                                    style={{
                                        display: 'block', padding: '13px 20px',
                                        background: '#FFF0F5', color: accent,
                                        border: `2px solid ${accent}`,
                                        borderRadius: 12, textDecoration: 'none',
                                        fontWeight: 700, fontSize: 15, textAlign: 'center',
                                    }}
                                >
                                    New here? Create a Keycloak account →
                                </motion.a>
                            ))}
                        </>
                    )}
                    <BackLink onClick={() => navigate('/select-role')} />
                </GlassCard>
            </PageShell>
        );
    }

    // ── Shared-secret signup screen ────────────────────────────────────────

    if (screen === 'signup') {
        return (
            <PageShell>
                {/* Hidden auto-login form */}
                <form ref={loginFormRef} method="POST" action="/login/shared-secret" style={{ display: 'none' }}>
                    <input ref={loginUsernameRef} type="text" name="username" />
                    <input ref={loginPasswordRef} type="password" name="password" />
                </form>

                <GlassCard accent={accent}>
                    <RoleHeader icon={roleIcon} label={`Create ${roleLabel} Account`} accent={accent} />
                    <form onSubmit={handleSignupSubmit}>
                        <Field label="Username *" hint="Lowercase letters, digits, - and _ only">
                            <CupidInput
                                value={signupUsername}
                                onChange={e => setSignupUsername(e.target.value)}
                                placeholder={isCompany ? 'acme-corp' : 'first-capital-bank'}
                                accent={accent}
                                autoFocus
                            />
                        </Field>
                        <Field label="Password" hint="Leave blank for demo default">
                            <CupidInput
                                type="password"
                                value={signupPassword}
                                onChange={e => setSignupPassword(e.target.value)}
                                placeholder="Choose a password (optional)"
                                accent={accent}
                            />
                        </Field>
                        <Field label={isCompany ? 'Company Name *' : 'Institution Name *'}>
                            <CupidInput
                                value={signupDisplayName}
                                onChange={e => setSignupDisplayName(e.target.value)}
                                placeholder={isCompany ? 'Acme Manufacturing Corp' : 'First Capital Bank'}
                                accent={accent}
                            />
                        </Field>
                        <Field label="Sector">
                            <select
                                value={signupSector}
                                onChange={e => setSignupSector(e.target.value)}
                                style={{ ...cupidInputStyle(accent), cursor: 'pointer' }}
                            >
                                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </Field>
                        <motion.button
                            type="submit"
                            disabled={loading}
                            whileHover={{ scale: loading ? 1 : 1.02 }}
                            whileTap={{ scale: loading ? 1 : 0.97 }}
                            style={{
                                width: '100%', padding: '14px 0', marginTop: 8,
                                background: loading ? '#D4A0AD' : accent,
                                color: '#fff', border: 'none', borderRadius: 12,
                                fontWeight: 800, fontSize: 16, cursor: loading ? 'wait' : 'pointer',
                                boxShadow: `0 4px 18px ${accent}40`,
                            }}
                        >
                            {loading ? 'Creating account…' : `Create ${roleLabel} Account →`}
                        </motion.button>
                    </form>
                    <Divider />
                    <button
                        onClick={() => setScreen('login')}
                        style={ghostBtnStyle(accent)}
                    >
                        Already have an account? Sign in
                    </button>
                    <BackLink onClick={() => navigate('/select-role')} />
                </GlassCard>
            </PageShell>
        );
    }

    // ── Shared-secret login screen (default) ──────────────────────────────

    return (
        <PageShell>
            <GlassCard accent={accent}>
                <RoleHeader icon={roleIcon} label={`Sign in as ${roleLabel}`} accent={accent} />
                <p style={{ textAlign: 'center', color: '#9E6B7D', fontSize: 14, marginBottom: 24 }}>
                    Enter your credentials to continue
                </p>

                <form name="f" action="/login/shared-secret" method="POST">
                    <input type="hidden" name="intent" value={role.toLowerCase()} />
                    <Field label="Username">
                        <CupidInput name="username" placeholder="your-username" accent={accent} autoFocus />
                    </Field>
                    <Field label="Password">
                        <CupidInput name="password" type="password" placeholder="your-password" accent={accent} />
                    </Field>
                    <motion.button
                        type="submit"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        style={{
                            width: '100%', padding: '14px 0', marginTop: 4,
                            background: accent, color: '#fff', border: 'none',
                            borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer',
                            boxShadow: `0 4px 18px ${accent}45`,
                        }}
                    >
                        Sign In →
                    </motion.button>
                </form>

                <div style={{ marginTop: 14, background: 'rgba(255,75,110,0.07)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#9E6B7D' }}>
                    <strong style={{ display: 'block', marginBottom: 4 }}>Demo accounts</strong>
                    <div>Company: <code style={{ color: accent }}>app-provider</code> / <code style={{ color: accent }}>abc123</code></div>
                    <div>Institution: <code style={{ color: accent }}>app-user</code> / <code style={{ color: accent }}>abc123</code></div>
                </div>

                <Divider />
                <motion.button
                    onClick={() => setScreen('signup')}
                    whileHover={{ scale: 1.02 }}
                    style={ghostBtnStyle(accent)}
                >
                    New here? Create a {roleLabel} account
                </motion.button>
                <BackLink onClick={() => navigate('/select-role')} />
            </GlassCard>
        </PageShell>
    );
};

// ─── Sub-components ───────────────────────────────────────────────────────

const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #FFF0F5 0%, #FFE4EE 50%, #FFF5E8 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px',
    }}>
        <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            style={{ width: '100%', maxWidth: 460 }}
        >
            {children}
        </motion.div>
    </div>
);

const GlassCard: React.FC<{ accent: string; children: React.ReactNode }> = ({ children }) => (
    <div style={{
        background: 'rgba(255,255,255,0.78)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: `1.5px solid rgba(255,75,110,0.2)`,
        borderRadius: 24,
        padding: '36px 32px',
        boxShadow: `0 12px 40px rgba(255,75,110,0.14), 0 0 0 1px rgba(255,75,110,0.08)`,
    }}>
        {children}
    </div>
);

const RoleHeader: React.FC<{ icon: string; label: string; accent: string }> = ({ icon, label, accent: _accent }) => (
    <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <motion.div
            animate={{ rotate: [-5, 5, -5], y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: 44, marginBottom: 10 }}
        >
            {icon}
        </motion.div>
        <h2 style={{
            margin: 0, fontSize: 22, fontWeight: 800,
            background: 'linear-gradient(135deg, #FF4B6E, #C9956C)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
            {label}
        </h2>
    </div>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div style={{ marginBottom: 14, textAlign: 'left' }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#2D0A1A', marginBottom: 4 }}>
            {label}
        </label>
        {hint && <div style={{ fontSize: 11, color: '#C9956C', marginBottom: 4 }}>{hint}</div>}
        {children}
    </div>
);

const cupidInputStyle = (_accent: string): React.CSSProperties => ({
    width: '100%', padding: '11px 14px',
    border: `2px solid rgba(255,75,110,0.2)`,
    borderRadius: 10, fontSize: 14, outline: 'none',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.9)',
    color: '#2D0A1A',
    transition: 'border-color 0.2s',
});

const CupidInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { accent: string }> = ({ accent, ...props }) => (
    <input
        {...props}
        style={cupidInputStyle(accent)}
        onFocus={e => { e.target.style.borderColor = accent; e.target.style.boxShadow = `0 0 0 3px ${accent}20`; }}
        onBlur={e => { e.target.style.borderColor = 'rgba(255,75,110,0.2)'; e.target.style.boxShadow = 'none'; }}
    />
);

const Divider = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,75,110,0.15)' }} />
        <span style={{ fontSize: 12, color: '#C9956C' }}>or</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,75,110,0.15)' }} />
    </div>
);

const ghostBtnStyle = (accent: string): React.CSSProperties => ({
    width: '100%', padding: '13px 0',
    background: 'transparent',
    color: accent,
    border: `2px solid ${accent}`,
    borderRadius: 12, fontWeight: 700, fontSize: 15,
    cursor: 'pointer',
});

const BackLink: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        style={{
            display: 'block', width: '100%', marginTop: 16,
            background: 'none', border: 'none',
            color: '#C9956C', cursor: 'pointer', fontSize: 13,
            textAlign: 'center',
        }}
    >
        ← Change role
    </button>
);

export default LoginView;
