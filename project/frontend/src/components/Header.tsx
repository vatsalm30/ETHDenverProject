// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import { Link } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';
import { useProfile } from '../stores/profileStore';

const Header: React.FC = () => {
    const { user, loading, fetchUser, logout } = useUserStore();
    const { myProfile } = useProfile();

    React.useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    const isCompany = myProfile?.type === 'COMPANY';
    const isInstitution = myProfile?.type === 'INSTITUTION';

    const roleBadgeStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        background: isCompany ? '#ede9fe' : isInstitution ? '#d1fae5' : '#f3f4f6',
        color: isCompany ? '#4f46e5' : isInstitution ? '#065f46' : '#6b7280',
        marginRight: 12,
    };

    return (
        <header>
            <nav className="navbar navbar-expand-lg navbar-light bg-light">
                <div className="container-fluid">
                    <Link className="navbar-brand fw-bold" to="/dashboard" style={{ color: '#4f46e5', textDecoration: 'none' }}>
                        Canton · Invoice Finance
                    </Link>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                        {!loading && user !== null && (
                            <>
                                {myProfile && (
                                    <span style={roleBadgeStyle}>
                                        {isCompany ? '🏭' : isInstitution ? '🏦' : '👤'}
                                        {myProfile.displayName ?? user.name}
                                        {isCompany ? ' · Company' : isInstitution ? ' · Institution' : ''}
                                    </span>
                                )}
                                <button
                                    className="btn btn-sm btn-outline-secondary"
                                    onClick={logout}
                                >
                                    Logout
                                </button>
                            </>
                        )}
                        {!loading && user === null && (
                            <Link className="btn btn-sm btn-primary" to="/login">Log In</Link>
                        )}
                    </div>
                </div>
            </nav>
        </header>
    );
};

export default Header;
