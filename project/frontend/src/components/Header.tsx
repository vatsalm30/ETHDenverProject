// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useUserStore } from '../stores/userStore';
import { useProfile } from '../stores/profileStore';

const Header: React.FC = () => {
    const { user, loading, fetchUser, logout } = useUserStore();
    const { myProfile } = useProfile();
    const navigate = useNavigate();

    React.useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    const isCompany = myProfile?.type === 'COMPANY';
    const isInstitution = myProfile?.type === 'INSTITUTION';
    const accent = isCompany ? '#FF4B6E' : isInstitution ? '#C9956C' : '#FF4B6E';

    const handleLogout = () => {
        logout();
        navigate('/select-role');
    };

    return (
        <header style={{
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,75,110,0.15)',
            boxShadow: '0 2px 20px rgba(255,75,110,0.08)',
        }}>
            <div style={{
                maxWidth: 1200,
                margin: '0 auto',
                padding: '0 24px',
                height: 60,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                {/* Brand */}
                <Link to="/dashboard" style={{ textDecoration: 'none' }}>
                    <motion.div
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                    >
                        <motion.span
                            animate={{ rotate: [-8, 8, -8], y: [0, -3, 0] }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                            style={{ fontSize: 22, lineHeight: 1 }}
                        >
                            💘
                        </motion.span>
                        <span style={{
                            fontSize: 17,
                            fontWeight: 900,
                            background: 'linear-gradient(135deg, #FF4B6E 0%, #C9956C 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            letterSpacing: '-0.3px',
                        }}>
                            Canton Invoice Finance
                        </span>
                    </motion.div>
                </Link>

                {/* Right side */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {!loading && user !== null && (
                        <>
                            {myProfile && (
                                <motion.div
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '5px 14px',
                                        borderRadius: 999,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        background: isCompany
                                            ? 'rgba(255,75,110,0.1)'
                                            : 'rgba(201,149,108,0.12)',
                                        color: accent,
                                        border: `1.5px solid ${accent}30`,
                                    }}
                                >
                                    <span>{isCompany ? '🏭' : '🏦'}</span>
                                    <span>{myProfile.displayName ?? user.name}</span>
                                    <span style={{ opacity: 0.7, fontSize: 11 }}>
                                        · {isCompany ? 'Company' : 'Institution'}
                                    </span>
                                </motion.div>
                            )}
                            <motion.button
                                onClick={handleLogout}
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.97 }}
                                style={{
                                    padding: '6px 16px',
                                    borderRadius: 999,
                                    border: `1.5px solid rgba(255,75,110,0.3)`,
                                    background: 'transparent',
                                    color: '#9E6B7D',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                Sign Out
                            </motion.button>
                        </>
                    )}
                    {!loading && user === null && (
                        <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                            <Link
                                to="/select-role"
                                style={{
                                    display: 'inline-block',
                                    padding: '6px 18px',
                                    borderRadius: 999,
                                    background: 'linear-gradient(135deg, #FF4B6E, #C9956C)',
                                    color: '#fff',
                                    textDecoration: 'none',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    boxShadow: '0 3px 12px rgba(255,75,110,0.35)',
                                }}
                            >
                                Get Started →
                            </Link>
                        </motion.div>
                    )}
                </div>
            </div>
        </header>
    );
};

export default Header;
