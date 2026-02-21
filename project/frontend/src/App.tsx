// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import './App.css';
import { Routes, Route } from 'react-router-dom';
import { ToastProvider } from './stores/toastStore';
import { ThemeProvider } from './stores/themeStore';
import HomeView from './views/HomeView';
import LoginView from './views/LoginView';
import DashboardView from './views/DashboardView';
import SelectRoleView from './views/SelectRoleView';
import AdminNetworkView from './views/AdminNetworkView';
import { UserProvider } from './stores/userStore';
import Header from './components/Header';
import ToastNotification from './components/ToastNotification';
import { InvoiceFinanceProvider } from './stores/invoiceFinanceStore';
import { ProfileProvider } from './stores/profileStore';

const App: React.FC = () => {
    const AppProviders = composeProviders(
        ThemeProvider,
        ToastProvider,
        UserProvider,
        InvoiceFinanceProvider,
        ProfileProvider
    );

    return (
        <AppProviders>
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                <Header />
                <main style={{ flex: 1 }}>
                    <Routes>
                        <Route path="/" element={<HomeView />} />
                        <Route path="/select-role" element={<SelectRoleView />} />
                        <Route path="/login" element={<LoginView />} />
                        <Route path="/dashboard" element={<DashboardView />} />
                        <Route path="/admin/network" element={<AdminNetworkView />} />
                    </Routes>
                </main>
                {/* Bottom ticker bar */}
                <div style={{
                    height: 26,
                    background: 'var(--surface)',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 16px',
                    gap: 16,
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: '0.59rem',
                    color: 'var(--text-3)',
                    flexShrink: 0,
                }}>
                    <span>CANTON NETWORK</span>
                    <span style={{ color: 'var(--border2)' }}>│</span>
                    <span>GLOBAL SYNCHRONIZER</span>
                    <span style={{ color: 'var(--border2)' }}>│</span>
                    <span>ZK TRUST SCORING</span>
                    <span style={{ marginLeft: 'auto' }}>
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                </div>
            </div>
            <ToastNotification />
        </AppProviders>
    );
};

const composeProviders = (...providers: React.ComponentType<{ children: React.ReactNode }>[]) => {
    return providers.reduce(
        (AccumulatedProviders, CurrentProvider) => {
            return ({ children }: { children: React.ReactNode }) => (
                <AccumulatedProviders>
                    <CurrentProvider>
                        {children}
                    </CurrentProvider>
                </AccumulatedProviders>
            );
        },
        ({ children }: { children: React.ReactNode }) => <>{children}</>
    );
};

export default App;
