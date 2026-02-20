// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    motion,
    useMotionValue,
    useSpring,
    useTransform,
} from 'framer-motion';

// ─── Particle config ───────────────────────────────────────────────────────

interface Particle {
    id: number;
    baseX: number;
    baseY: number;
    emoji: string;
    size: number;
    duration: number;
    strength: number; // parallax sensitivity
}

const PARTICLES: Particle[] = [
    { id: 0,  baseX:  5, baseY: 12, emoji: '💗', size: 32, duration: 3.5, strength: -0.04 },
    { id: 1,  baseX: 90, baseY:  8, emoji: '💕', size: 24, duration: 4.2, strength:  0.05 },
    { id: 2,  baseX: 12, baseY: 72, emoji: '✨', size: 20, duration: 3.8, strength: -0.03 },
    { id: 3,  baseX: 93, baseY: 65, emoji: '💖', size: 36, duration: 5.0, strength:  0.06 },
    { id: 4,  baseX: 48, baseY:  4, emoji: '💫', size: 18, duration: 3.2, strength: -0.05 },
    { id: 5,  baseX: 78, baseY: 88, emoji: '🌸', size: 26, duration: 4.5, strength:  0.04 },
    { id: 6,  baseX: 22, baseY: 44, emoji: '💗', size: 16, duration: 3.7, strength: -0.02 },
    { id: 7,  baseX: 66, baseY: 28, emoji: '✨', size: 28, duration: 4.1, strength:  0.07 },
    { id: 8,  baseX: 54, baseY: 82, emoji: '💕', size: 22, duration: 3.9, strength: -0.05 },
    { id: 9,  baseX:  8, baseY: 55, emoji: '💖', size: 14, duration: 5.5, strength:  0.03 },
    { id: 10, baseX: 83, baseY: 40, emoji: '🌸', size: 20, duration: 4.3, strength: -0.06 },
    { id: 11, baseX: 35, baseY: 20, emoji: '💫', size: 18, duration: 3.6, strength:  0.04 },
    { id: 12, baseX: 60, baseY: 55, emoji: '💗', size: 14, duration: 4.8, strength: -0.04 },
    { id: 13, baseX: 30, baseY: 90, emoji: '✨', size: 16, duration: 3.3, strength:  0.05 },
    { id: 14, baseX: 72, baseY: 18, emoji: '💕', size: 20, duration: 4.6, strength: -0.03 },
];

// ─── Single particle (needs its own component to create per-particle motion values) ──

const FloatingParticle: React.FC<{
    p: Particle;
    rawX: ReturnType<typeof useMotionValue<number>>;
    rawY: ReturnType<typeof useMotionValue<number>>;
}> = ({ p, rawX, rawY }) => {
    const springCfg = { stiffness: 60, damping: 22 };
    const px = useSpring(useTransform(rawX, (v) => v * p.strength), springCfg);
    const py = useSpring(useTransform(rawY, (v) => v * p.strength), springCfg);

    return (
        <motion.div
            style={{
                position: 'absolute',
                left: `${p.baseX}%`,
                top: `${p.baseY}%`,
                x: px,
                y: py,
                pointerEvents: 'none',
                userSelect: 'none',
                zIndex: 0,
                opacity: 0.65,
                fontSize: p.size,
            }}
        >
            <motion.span
                style={{ display: 'block' }}
                animate={{ y: [0, -18, 0, 8, 0], rotate: [-7, 7, -7], scale: [1, 1.08, 1] }}
                transition={{ duration: p.duration, repeat: Infinity, ease: 'easeInOut', delay: p.id * 0.35 }}
            >
                {p.emoji}
            </motion.span>
        </motion.div>
    );
};

// ─── Tilt-on-hover role card ───────────────────────────────────────────────

interface RoleCardProps {
    icon: string;
    role: 'COMPANY' | 'INSTITUTION';
    title: string;
    subtitle: string;
    bullets: string[];
    accentColor: string;
    accentLight: string;
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
                    background: 'rgba(255,255,255,0.75)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: `2px solid ${hovered ? accentColor : 'rgba(255,75,110,0.18)'}`,
                    borderRadius: 24,
                    padding: '36px 32px',
                    boxShadow: hovered
                        ? `0 24px 48px ${accentColor}30, 0 0 0 1px ${accentColor}20`
                        : '0 8px 32px rgba(255,75,110,0.14)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
            >
                <div style={{ fontSize: 52, marginBottom: 12, textAlign: 'center' }}>{icon}</div>
                <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800, color: '#2D0A1A', textAlign: 'center' }}>
                    {title}
                </h2>
                <p style={{ margin: '0 0 20px', color: '#9E6B7D', fontSize: 14, textAlign: 'center', lineHeight: 1.5 }}>
                    {subtitle}
                </p>
                <ul style={{ margin: '0 0 24px', padding: 0, listStyle: 'none' }}>
                    {bullets.map((b, i) => (
                        <li key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 0', fontSize: 13, color: '#2D0A1A', borderBottom: '1px solid rgba(255,75,110,0.08)',
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
                        background: accentColor,
                        color: '#fff',
                        borderRadius: 12,
                        fontWeight: 800,
                        fontSize: 16,
                        textAlign: 'center',
                        boxShadow: `0 4px 18px ${accentColor}50`,
                    }}
                >
                    Get Started →
                </motion.div>
            </motion.div>
        </motion.div>
    );
};

// ─── Main SelectRoleView ───────────────────────────────────────────────────

const SelectRoleView: React.FC = () => {
    const navigate = useNavigate();
    const rawX = useMotionValue(0);
    const rawY = useMotionValue(0);

    const handleMouseMove = (e: React.MouseEvent) => {
        rawX.set(e.clientX - window.innerWidth / 2);
        rawY.set(e.clientY - window.innerHeight / 2);
    };

    const pick = (role: 'COMPANY' | 'INSTITUTION') => {
        localStorage.setItem('cupid-role', role);
        navigate('/login');
    };

    return (
        <div
            onMouseMove={handleMouseMove}
            style={{
                position: 'relative',
                minHeight: '100vh',
                background: 'linear-gradient(160deg, #FFF0F5 0%, #FFE4EE 50%, #FFF5E8 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 24px',
                overflow: 'hidden',
            }}
        >
            {/* Particle field */}
            {PARTICLES.map((p) => (
                <FloatingParticle key={p.id} p={p} rawX={rawX} rawY={rawY} />
            ))}

            {/* Hero text */}
            <motion.div
                initial={{ opacity: 0, y: -24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.1 }}
                style={{ textAlign: 'center', marginBottom: 48, position: 'relative', zIndex: 1 }}
            >
                <motion.div
                    animate={{ rotate: [-8, 8, -8], y: [0, -6, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    style={{ fontSize: 56, marginBottom: 16 }}
                >
                    💘
                </motion.div>
                <h1 style={{
                    margin: '0 0 12px',
                    fontSize: 'clamp(28px, 5vw, 48px)',
                    fontWeight: 900,
                    background: 'linear-gradient(135deg, #FF4B6E 0%, #C9956C 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    lineHeight: 1.15,
                }}>
                    Canton Invoice Finance
                </h1>
                <p style={{ margin: 0, fontSize: 18, color: '#9E6B7D', fontWeight: 500 }}>
                    Who are you? Let's find your perfect match.
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
                    subtitle="Make your invoices irresistible and get paid early"
                    bullets={[
                        'Upload invoices with AI-assisted parsing',
                        'Launch sealed-bid auctions',
                        'Receive early payment, stay cashflow-positive',
                    ]}
                    accentColor="#FF4B6E"
                    accentLight="#FFF0F5"
                    onClick={() => pick('COMPANY')}
                    delay={0.25}
                />
                <RoleCard
                    icon="🏦"
                    role="INSTITUTION"
                    title="I'm an Institution"
                    subtitle="Discover invoices worth funding and earn yield"
                    bullets={[
                        'Browse live auction opportunities',
                        'Place confidential sealed bids',
                        'Earn yield when invoices mature',
                    ]}
                    accentColor="#C9956C"
                    accentLight="#FFF5EE"
                    onClick={() => pick('INSTITUTION')}
                    delay={0.38}
                />
            </div>

            {/* Footer tagline */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                style={{ marginTop: 48, fontSize: 13, color: '#C9956C', position: 'relative', zIndex: 1 }}
            >
                Matchmaking businesses with liquidity · Powered by Canton Network
            </motion.p>
        </div>
    );
};

export default SelectRoleView;
