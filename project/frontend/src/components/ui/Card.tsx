// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Card

import React from 'react';
import { motion } from 'framer-motion';

const fadeUp = {
    hidden: { opacity: 0, y: 20, scale: 0.98 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 22 } },
};

interface CardProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    onClick?: () => void;
    noPad?: boolean;
    animate?: boolean;
}

const Card: React.FC<CardProps> = ({ children, style, onClick, noPad, animate = true }) => {
    const base: React.CSSProperties = {
        background: 'var(--c-glass)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--c-border)',
        borderRadius: 16,
        padding: noPad ? 0 : 20,
        marginBottom: 14,
        boxShadow: 'var(--c-shadow)',
        ...style,
    };

    if (!animate) {
        return <div style={base} onClick={onClick}>{children}</div>;
    }

    return (
        <motion.div variants={fadeUp} onClick={onClick} style={base}>
            {children}
        </motion.div>
    );
};

export default Card;
