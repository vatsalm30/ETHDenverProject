// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import './App.css';
import { Routes, Route } from 'react-router-dom';
import { ToastProvider } from './stores/toastStore';
import HomeView from './views/HomeView';
import LoginView from './views/LoginView';
import DashboardView from './views/DashboardView';
import { UserProvider } from './stores/userStore';
import Header from './components/Header';
import ToastNotification from './components/ToastNotification';
import { InvoiceFinanceProvider } from './stores/invoiceFinanceStore';
import { ProfileProvider } from './stores/profileStore';

const App: React.FC = () => {
    const AppProviders = composeProviders(
        ToastProvider,
        UserProvider,
        InvoiceFinanceProvider,
        ProfileProvider
    );

    return (
        <AppProviders>
            <Header />
            <main className="container mt-4">
                <Routes>
                    <Route path="/" element={<HomeView />} />
                    <Route path="/login" element={<LoginView />} />
                    <Route path="/dashboard" element={<DashboardView />} />
                </Routes>
            </main>
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
