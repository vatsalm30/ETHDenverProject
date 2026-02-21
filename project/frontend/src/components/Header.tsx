// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';
import { useProfile } from '../stores/profileStore';
import { useTheme } from '../stores/themeStore';

const Header: React.FC = () => {
    const { user, loading, fetchUser, logout } = useUserStore();
    const { myProfile } = useProfile();
    const { theme, toggle } = useTheme();
    const navigate = useNavigate();

    React.useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    const isCompany = myProfile?.type === 'COMPANY';

    const handleLogout = () => {
        logout();
        navigate('/select-role');
    };

    return (
        <header style={{
            position: 'sticky',
            top: 0,
            zIndex: 1000,
        }}>
            <div style={{
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                height: 54,
            }}>
                <div style={{
                    maxWidth: 1200,
                    margin: '0 auto',
                    padding: '0 16px',
                    height: 54,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    {/* Brand */}
                    <Link to="/dashboard" style={{ textDecoration: 'none' }}>
                        <span style={{
                            fontFamily: "'Barlow Condensed', sans-serif",
                            fontSize: 16,
                            fontWeight: 900,
                            color: 'var(--red)',
                            letterSpacing: '2px',
                            textTransform: 'uppercase' as const,
                        }}>
                            INVOICE NOW
                        </span>
                    </Link>

                    {/* Right side */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* Theme toggle */}
                        <button
                            onClick={toggle}
                            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                            style={{
                                width: 32,
                                height: 32,
                                border: '1px solid var(--border2)',
                                background: 'transparent',
                                color: 'var(--text-3)',
                                fontSize: 14,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            {theme === 'light' ? '☾' : '☀'}
                        </button>

                        {!loading && user !== null && (
                            <>
                                {myProfile && (
                                    <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '4px 10px',
                                        fontSize: 12,
                                        fontFamily: "'Barlow Condensed', sans-serif",
                                        fontWeight: 700,
                                        textTransform: 'uppercase' as const,
                                        letterSpacing: '1px',
                                        background: 'var(--surface2)',
                                        color: 'var(--text-1)',
                                        border: '1px solid var(--border)',
                                    }}>
                                        <span style={{
                                            fontFamily: "'Share Tech Mono', monospace",
                                            fontSize: 11,
                                            color: isCompany ? 'var(--red)' : 'var(--amber)',
                                        }}>
                                            {isCompany ? 'CO' : 'IN'}
                                        </span>
                                        <span>{myProfile.displayName ?? user.name}</span>
                                        <span style={{
                                            color: 'var(--text-3)',
                                            fontSize: 10,
                                            fontWeight: 600,
                                        }}>
                                            {isCompany ? 'COMPANY' : 'INSTITUTION'}
                                        </span>
                                    </div>
                                )}
                                <button
                                    onClick={handleLogout}
                                    style={{
                                        padding: '6px 14px',
                                        border: '1px solid var(--border2)',
                                        background: 'transparent',
                                        color: 'var(--text-2)',
                                        fontFamily: "'Barlow Condensed', sans-serif",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        textTransform: 'uppercase' as const,
                                        letterSpacing: '1.5px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    SIGN OUT
                                </button>
                            </>
                        )}
                        {!loading && user === null && (
                            <Link
                                to="/select-role"
                                style={{
                                    display: 'inline-block',
                                    padding: '6px 16px',
                                    background: 'var(--red)',
                                    color: '#fff',
                                    textDecoration: 'none',
                                    fontFamily: "'Barlow Condensed', sans-serif",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: 'uppercase' as const,
                                    letterSpacing: '1.5px',
                                }}
                            >
                                GET STARTED
                            </Link>
                        )}
                    </div>
                </div>
            </div>
            {/* 2px accent gradient line */}
            <div style={{
                height: 2,
                background: 'linear-gradient(90deg, #e8002d 25%, transparent 100%)',
            }} />
        </header>
    );
};

export default Header;
