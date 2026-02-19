// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect } from 'react';
import { useUserStore } from '../stores/userStore';
import { useNavigate } from 'react-router-dom';

const HomeView: React.FC = () => {
    const { user, loading } = useUserStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && user === null) {
            navigate('/login');
        } else if (!loading && user !== null) {
            navigate('/dashboard');
        }
    }, [user, loading, navigate]);

    return null;
};

export default HomeView;
