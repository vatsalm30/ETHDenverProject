// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeCtx {
    theme: Theme;
    toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const getInitial = (): Theme => {
        const stored = localStorage.getItem('theme') as Theme | null;
        if (stored === 'light' || stored === 'dark') return stored;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const [theme, setTheme] = useState<Theme>(getInitial);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light');

    return (
        <ThemeContext.Provider value={{ theme, toggle }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
