// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Button

import React from 'react';
import { motion } from 'framer-motion';

interface ButtonProps {
    onClick?: () => void;
    variant?: 'primary' | 'outline' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    children: React.ReactNode;
    style?: React.CSSProperties;
    type?: 'button' | 'submit';
}

const Button: React.FC<ButtonProps> = ({
    onClick, variant = 'primary', size = 'md', disabled, children, style, type = 'button',
}) => {
    const pad = size === 'sm' ? '6px 14px' : size === 'lg' ? '14px 28px' : '10px 20px';
    const fs = size === 'sm' ? 12 : size === 'lg' ? 16 : 14;

    const variants: Record<string, React.CSSProperties> = {
        primary: {
            background: disabled ? 'var(--c-border)' : 'var(--c-gradient)',
            color: disabled ? 'var(--c-muted)' : '#fff',
            border: 'none',
            boxShadow: disabled ? 'none' : '0 4px 14px rgba(79,70,229,0.25)',
        },
        outline: {
            background: 'transparent',
            color: 'var(--c-primary)',
            border: '2px solid var(--c-primary)',
        },
        ghost: {
            background: 'transparent',
            color: 'var(--c-primary)',
            border: 'none',
        },
    };

    return (
        <motion.button
            type={type}
            onClick={onClick}
            disabled={disabled}
            whileHover={{ scale: disabled ? 1 : 1.02 }}
            whileTap={{ scale: disabled ? 1 : 0.97 }}
            style={{
                padding: pad,
                fontSize: fs,
                fontWeight: 700,
                borderRadius: 10,
                cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
                ...variants[variant],
                ...style,
            }}
        >
            {children}
        </motion.button>
    );
};

export default Button;
