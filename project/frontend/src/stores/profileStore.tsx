// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { createContext, useContext, useState, useCallback } from 'react';
import api from '../api';
import type { Client, UserProfileDto, UpdateProfileRequest } from '../openapi.d.ts';

interface ProfileState {
    myProfile: UserProfileDto | null;
    profileCache: Record<string, UserProfileDto>;
}

interface ProfileContextType extends ProfileState {
    fetchMyProfile: () => Promise<void>;
    saveMyProfile: (req: UpdateProfileRequest) => Promise<void>;
    fetchProfile: (partyId: string) => Promise<UserProfileDto | null>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider = ({ children }: { children: React.ReactNode }) => {
    const [myProfile, setMyProfile] = useState<UserProfileDto | null>(null);
    const [profileCache, setProfileCache] = useState<Record<string, UserProfileDto>>({});

    const fetchMyProfile = useCallback(async () => {
        try {
            const client: Client = await api.getClient();
            const resp = await client.getMyProfile();
            setMyProfile(resp.data);
        } catch {
            // 404 means no profile yet — that's fine
        }
    }, []);

    const saveMyProfile = useCallback(async (req: UpdateProfileRequest) => {
        const client: Client = await api.getClient();
        const resp = await client.upsertMyProfile(null, req);
        setMyProfile(resp.data);
    }, []);

    const fetchProfile = useCallback(async (partyId: string): Promise<UserProfileDto | null> => {
        if (profileCache[partyId]) return profileCache[partyId];
        try {
            const client: Client = await api.getClient();
            const resp = await client.getProfile({ partyId });
            setProfileCache(prev => ({ ...prev, [partyId]: resp.data }));
            return resp.data;
        } catch {
            return null;
        }
    }, [profileCache]);

    return (
        <ProfileContext.Provider value={{
            myProfile, profileCache,
            fetchMyProfile, saveMyProfile, fetchProfile,
        }}>
            {children}
        </ProfileContext.Provider>
    );
};

export const useProfile = () => {
    const ctx = useContext(ProfileContext);
    if (!ctx) throw new Error('useProfile must be used within ProfileProvider');
    return ctx;
};
