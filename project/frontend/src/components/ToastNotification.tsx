// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React from 'react';
import { useToast } from '../stores/toastStore';

const ToastNotification: React.FC = () => {
    const { message, show, hideError } = useToast();

    const isError = message.startsWith("Error:");
    const isSuccess = message.startsWith("Success:");

    const borderColor = isError ? 'var(--red)' : isSuccess ? 'var(--green)' : 'var(--teal)';
    const headerText = isError ? 'ERROR' : isSuccess ? 'SUCCESS' : 'INFO';

    return (
        <div
            className="position-fixed mt3 start-50 translate-middle-x"
            style={{ zIndex: 2000, top: "3rem" }}
        >
            <div
                id="liveToast"
                className={`toast ${show ? 'show' : ''}`}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                style={{
                    background: 'var(--surface)',
                    border: `1px solid var(--border)`,
                    borderLeft: `3px solid ${borderColor}`,
                    color: 'var(--text-1)',
                }}
            >
                <div className="toast-header" style={{
                    background: 'var(--surface2)',
                    borderBottom: '1px solid var(--border)',
                    color: borderColor,
                }}>
                    <strong className="me-auto" style={{
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontWeight: 700,
                        textTransform: 'uppercase' as const,
                        letterSpacing: '1.5px',
                        fontSize: 11,
                    }}>{headerText}</strong>
                    <button
                        type="button"
                        className="btn-close"
                        onClick={hideError}
                        aria-label="Close"
                    ></button>
                </div>
                <div className="toast-body" style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: 12,
                    color: 'var(--text-1)',
                    padding: '8px 12px',
                }}>{message}</div>
            </div>
        </div>
    );
};

export default ToastNotification;
