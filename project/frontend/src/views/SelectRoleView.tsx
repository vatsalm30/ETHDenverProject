// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

// ─── Tilt-on-hover role card ───────────────────────────────────────────────

interface RoleCardProps {
    icon: string;
    role: 'COMPANY' | 'INSTITUTION';
    title: string;
    subtitle: string;
    bullets: string[];
    accentColor: string;
    onClick: () => void;
    delay: number;
}

const RoleCard: React.FC<RoleCardProps> = ({
    icon, title, subtitle, bullets, accentColor, onClick, delay,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [tilt, setTilt] = useState({ x: 0, y: 0 });
    const [hovered, setHovered] = useState(false);

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = cardRef.current!.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / rect.width - 0.5;
        const cy = (e.clientY - rect.top) / rect.height - 0.5;
        setTilt({ x: cy * -14, y: cx * 14 });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring' as const, stiffness: 280, damping: 22, delay }}
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { setTilt({ x: 0, y: 0 }); setHovered(false); }}
            onMouseEnter={() => setHovered(true)}
            onClick={onClick}
            style={{
                perspective: 1000,
                transformStyle: 'preserve-3d',
                cursor: 'pointer',
                width: '100%',
                maxWidth: 340,
            }}
        >
            <motion.div
                animate={{ rotateX: tilt.x, rotateY: tilt.y, scale: hovered ? 1.03 : 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, mass: 0.5 }}
                style={{
                    background: 'var(--c-glass)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: `2px solid ${hovered ? accentColor : 'var(--c-border)'}`,
                    borderRadius: 24,
                    padding: '36px 32px',
                    boxShadow: hovered
                        ? `0 24px 48px rgba(0,0,0,0.14), 0 0 0 1px ${accentColor}20`
                        : 'var(--c-shadow)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
            >
                <div style={{ fontSize: 52, marginBottom: 12, textAlign: 'center' }}>{icon}</div>
                <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: 'var(--c-text)', textAlign: 'center' }}>
                    {title}
                </h2>
                <p style={{ margin: '0 0 20px', color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', lineHeight: 1.5 }}>
                    {subtitle}
                </p>
                <ul style={{ margin: '0 0 24px', padding: 0, listStyle: 'none' }}>
                    {bullets.map((b, i) => (
                        <li key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 0', fontSize: 13, color: 'var(--c-text)', borderBottom: '1px solid var(--c-border)',
                        }}>
                            <span style={{ color: accentColor, fontWeight: 900 }}>✓</span> {b}
                        </li>
                    ))}
                </ul>
                <motion.div
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.97 }}
                    style={{
                        padding: '14px 0',
                        background: 'var(--c-text)',
                        color: 'var(--c-bg)',
                        borderRadius: 12,
                        fontWeight: 800,
                        fontSize: 16,
                        textAlign: 'center',
                        boxShadow: '0 4px 18px rgba(0,0,0,0.14)',
                    }}
                >
                    Continue →
                </motion.div>
            </motion.div>
        </motion.div>
    );
};

// ─── Main SelectRoleView ───────────────────────────────────────────────────

const SelectRoleView: React.FC = () => {
    const navigate = useNavigate();

    const pick = (role: 'COMPANY' | 'INSTITUTION') => {
        localStorage.setItem('user-role', role);
        navigate('/login');
    };

    return (
        <div
            style={{
                position: 'relative',
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 24px',
                overflow: 'hidden',
            }}
        >
            {/* Hero text */}
            <motion.div
                initial={{ opacity: 0, y: -24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.1 }}
                style={{ textAlign: 'center', marginBottom: 48, position: 'relative', zIndex: 1 }}
            >
                <h1 style={{
                    margin: '0 0 12px',
                    fontSize: 'clamp(28px, 5vw, 48px)',
                    fontWeight: 900,
                    color: 'var(--c-text)',
                    lineHeight: 1.15,
                }}>
                    Invoice Now
                </h1>
                <p style={{ margin: 0, fontSize: 18, color: 'var(--c-muted)', fontWeight: 500 }}>
                    Select your account type to continue.
                </p>
            </motion.div>

            {/* Role cards */}
            <div style={{
                display: 'flex',
                gap: 32,
                flexWrap: 'wrap',
                justifyContent: 'center',
                position: 'relative',
                zIndex: 1,
                width: '100%',
                maxWidth: 760,
            }}>
                <RoleCard
                    icon="🏭"
                    role="COMPANY"
                    title="I'm a Company"
                    subtitle="Access early liquidity on outstanding receivables."
                    bullets={[
                        'Upload invoices with AI-assisted parsing',
                        'Submit receivables for competitive financing',
                        'Receive early payment to optimize working capital',
                    ]}
                    accentColor="var(--c-primary)"
                    onClick={() => pick('COMPANY')}
                    delay={0.25}
                />
                <RoleCard
                    icon="🏦"
                    role="INSTITUTION"
                    title="I'm an Institution"
                    subtitle="Deploy capital into verified receivables and earn yield."
                    bullets={[
                        'Browse active financing opportunities',
                        'Submit confidential financing proposals',
                        'Earn yield when invoices mature',
                    ]}
                    accentColor="var(--c-gold)"
                    onClick={() => pick('INSTITUTION')}
                    delay={0.38}
                />
            </div>

            {/* Footer tagline */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                style={{ marginTop: 48, fontSize: 13, color: 'var(--c-muted)', position: 'relative', zIndex: 1 }}
            >
                Distributed settlement infrastructure · Powered by Canton Network
            </motion.p>
        </div>
    );
};

export default SelectRoleView;
