// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Card

import React from 'react';

interface CardProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    onClick?: () => void;
    noPad?: boolean;
    animate?: boolean;
}

const Card: React.FC<CardProps> = ({ children, style, onClick, noPad }) => {
    const base: React.CSSProperties = {
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        padding: noPad ? 0 : '12px 14px',
        marginBottom: 2,
        ...style,
    };

    return <div style={base} onClick={onClick}>{children}</div>;
};

export default Card;
