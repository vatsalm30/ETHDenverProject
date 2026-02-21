// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Badge

import React from 'react';

interface BadgeProps {
    status: string;
    style?: React.CSSProperties;
}

const statusMap: Record<string, { bg: string; color: string; border: string }> = {
    CONFIRMED:            { bg: 'var(--teal-bg)',  color: 'var(--teal)',  border: 'rgba(0,180,166,0.25)' },
    PENDING_CONFIRMATION: { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'rgba(210,153,34,0.25)' },
    IN_AUCTION:           { bg: 'var(--amber-bg)', color: 'var(--amber)', border: 'rgba(210,153,34,0.25)' },
    FINANCED:             { bg: 'rgba(63,185,80,0.10)', color: 'var(--green)', border: 'rgba(63,185,80,0.25)' },
    PAID:                 { bg: 'rgba(63,185,80,0.10)', color: 'var(--green)', border: 'rgba(63,185,80,0.25)' },
    OPEN:                 { bg: 'var(--teal-bg)',  color: 'var(--teal)',  border: 'rgba(0,180,166,0.25)' },
    CLOSED:               { bg: 'var(--surface3)', color: 'var(--text-3)', border: 'var(--border)' },
};

const Badge: React.FC<BadgeProps> = ({ status, style }) => {
    const c = statusMap[status] ?? { bg: 'var(--surface3)', color: 'var(--text-3)', border: 'var(--border)' };
    return (
        <span style={{
            background: c.bg,
            color: c.color,
            border: `1px solid ${c.border}`,
            padding: '2px 7px',
            fontSize: '0.65rem',
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '1px',
            display: 'inline-block',
            ...style,
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
};

export default Badge;
