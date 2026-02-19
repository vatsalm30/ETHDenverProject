// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useToast } from './toastStore';
import api from '../api';
import type { AuthenticatedUser, Client } from "../openapi.d.ts";

interface UserContextType {
    user: AuthenticatedUser | null;
    loading: boolean;
    fetchUser: () => Promise<void>;
    clearUser: () => void;
    logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<AuthenticatedUser | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const toast = useToast();

    const fetchUser = useCallback(async () => {
        setLoading(true);
        try {
            const client: Client = await api.getClient();
            const response = await client.getAuthenticatedUser();
            setUser(response.data);
        } catch (error) {
            if ((error as any)?.response?.status === 401) {
                setUser(null);
            } else {
                toast.displayError('Error fetching user');
            }
        } finally {
            setLoading(false);
        }
    }, [setUser, setLoading, toast]);

    const clearUser = useCallback(() => {
        setUser(null);
    }, [setUser]);

    const getCsrfToken = (): string => {
        const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    };

    const logout = useCallback(() => {
        // Submit a form POST to /api/logout so the browser follows the full redirect chain:
        //  • OAuth2 mode: Spring → Keycloak end_session (clears SSO) → back to app
        //  • Shared-secret: Spring → redirect to /
        // This is a full page navigation, so React state is wiped on reload.
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/api/logout';
        // Include CSRF token as a form field (works in OAuth2 mode; ignored in shared-secret)
        const csrf = document.createElement('input');
        csrf.type = 'hidden';
        csrf.name = '_csrf';
        csrf.value = getCsrfToken();
        form.appendChild(csrf);
        document.body.appendChild(form);
        form.submit();
    }, [getCsrfToken]);

    return (
        <UserContext.Provider value={{ user, loading, fetchUser, clearUser, logout }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUserStore = () => {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};
