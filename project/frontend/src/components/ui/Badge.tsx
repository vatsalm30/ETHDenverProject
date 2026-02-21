// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Badge

import React from 'react';

interface BadgeProps {
    status: string;
    style?: React.CSSProperties;
}

const statusMap: Record<string, { bg: string; color: string }> = {
    CONFIRMED:            { bg: 'rgba(79,70,229,0.12)',  color: 'var(--c-primary)' },
    PENDING_CONFIRMATION: { bg: 'rgba(245,158,11,0.12)', color: '#92400e' },
    IN_AUCTION:           { bg: 'rgba(124,58,237,0.12)', color: 'var(--c-gold)' },
    FINANCED:             { bg: 'rgba(16,185,129,0.12)', color: '#065f46' },
    PAID:                 { bg: 'rgba(16,185,129,0.12)', color: '#065f46' },
    OPEN:                 { bg: 'rgba(79,70,229,0.12)',  color: 'var(--c-primary)' },
    CLOSED:               { bg: 'rgba(107,114,128,0.12)', color: 'var(--c-muted)' },
};

const Badge: React.FC<BadgeProps> = ({ status, style }) => {
    const c = statusMap[status] ?? { bg: 'rgba(107,114,128,0.12)', color: 'var(--c-muted)' };
    return (
        <span style={{
            background: c.bg, color: c.color,
            padding: '3px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 700,
            display: 'inline-block',
            ...style,
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

export default Badge;
