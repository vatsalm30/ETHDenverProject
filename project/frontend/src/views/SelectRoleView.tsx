// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const F = {
    heading: "'Barlow Condensed', sans-serif",
    mono: "'Share Tech Mono', monospace",
    body: "'Barlow', sans-serif",
};

interface RoleCardProps {
    role: 'COMPANY' | 'INSTITUTION';
    title: string;
    subtitle: string;
    bullets: string[];
    accentColor: string;
    onClick: () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({
    title, subtitle, bullets, accentColor, onClick,
}) => {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onClick}
            style={{
                cursor: 'pointer',
                width: '100%',
                maxWidth: 320,
            }}
        >
            <div style={{
                background: 'var(--surface)',
                border: `1px solid ${hovered ? accentColor : 'var(--border)'}`,
                padding: '24px 20px',
                transition: 'border-color 0.15s',
            }}>
                <div style={{
                    width: 40, height: 3,
                    background: accentColor,
                    marginBottom: 14,
                }} />
                <h2 style={{
                    margin: '0 0 6px',
                    fontFamily: F.heading,
                    fontSize: 18, fontWeight: 700,
                    color: 'var(--text-1)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '1px',
                }}>
                    {title}
                </h2>
                <p style={{
                    margin: '0 0 14px',
                    color: 'var(--text-3)',
                    fontFamily: F.body,
                    fontSize: 13, lineHeight: 1.5,
                }}>
                    {subtitle}
                </p>
                <ul style={{ margin: '0 0 16px', padding: 0, listStyle: 'none' }}>
                    {bullets.map((b, i) => (
                        <li key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 0',
                            fontFamily: F.body, fontSize: 12,
                            color: 'var(--text-2)',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            <span style={{ fontFamily: F.mono, color: accentColor, fontWeight: 700, fontSize: 11 }}>+</span> {b}
                        </li>
                    ))}
                </ul>
                <div style={{
                    padding: '10px 0',
                    background: hovered ? accentColor : 'var(--surface3)',
                    color: hovered ? '#fff' : 'var(--text-2)',
                    fontFamily: F.heading, fontWeight: 700,
                    fontSize: 13,
                    textAlign: 'center',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '1.5px',
                    transition: 'background-color 0.15s, color 0.15s',
                }}>
                    CONTINUE
                </div>
            </div>
        </div>
    );
};

const SelectRoleView: React.FC = () => {
    const navigate = useNavigate();

    const pick = (role: 'COMPANY' | 'INSTITUTION') => {
        localStorage.setItem('user-role', role);
        navigate('/login');
    };

    return (
        <div style={{
            position: 'relative',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 16px',
        }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <h1 style={{
                    margin: '0 0 8px',
                    fontFamily: F.heading,
                    fontSize: 'clamp(24px, 4vw, 36px)',
                    fontWeight: 900,
                    color: 'var(--text-1)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '2px',
                    lineHeight: 1.15,
                }}>
                    INVOICE NOW
                </h1>
                <p style={{
                    margin: 0,
                    fontFamily: F.body,
                    fontSize: 14, color: 'var(--text-3)',
                }}>
                    Select your account type to continue.
                </p>
            </div>

            <div style={{
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                justifyContent: 'center',
                width: '100%',
                maxWidth: 680,
            }}>
                <RoleCard
                    role="COMPANY"
                    title="Company"
                    subtitle="Access early liquidity on outstanding receivables."
                    bullets={[
                        'Upload invoices with AI-assisted parsing',
                        'Submit receivables for competitive financing',
                        'Receive early payment to optimize working capital',
                    ]}
                    accentColor="var(--red)"
                    onClick={() => pick('COMPANY')}
                />
                <RoleCard
                    role="INSTITUTION"
                    title="Institution"
                    subtitle="Deploy capital into verified receivables and earn yield."
                    bullets={[
                        'Browse active financing opportunities',
                        'Submit confidential financing proposals',
                        'Earn yield when invoices mature',
                    ]}
                    accentColor="var(--amber)"
                    onClick={() => pick('INSTITUTION')}
                />
            </div>

            <p style={{
                marginTop: 32,
                fontFamily: F.mono,
                fontSize: '0.59rem', color: 'var(--text-3)',
                textTransform: 'uppercase' as const,
                letterSpacing: '2.5px',
            }}>
                Distributed settlement · Canton Network
            </p>
        </div>
    );
};

export default SelectRoleView;
