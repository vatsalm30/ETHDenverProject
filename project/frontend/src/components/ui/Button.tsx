// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD
// @bit invoice.ui/Button

import React from 'react';

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
    const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '10px 20px' : '8px 16px';
    const fs = size === 'sm' ? 11 : size === 'lg' ? 13 : 12;

    const variants: Record<string, React.CSSProperties> = {
        primary: {
            background: disabled ? 'var(--surface3)' : 'var(--red)',
            color: disabled ? 'var(--text-3)' : '#fff',
            border: 'none',
        },
        outline: {
            background: 'transparent',
            color: 'var(--text-2)',
            border: '1px solid var(--border2)',
        },
        ghost: {
            background: 'transparent',
            color: 'var(--text-2)',
            border: 'none',
        },
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            style={{
                padding: pad,
                fontSize: fs,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                textTransform: 'uppercase' as const,
                letterSpacing: '1.5px',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'background-color 0.1s',
                ...variants[variant],
                ...style,
            }}
        >
            {children}
        </button>
    );
};

export default Button;
