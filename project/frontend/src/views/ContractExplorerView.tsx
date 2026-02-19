// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { useEffect, useState } from 'react';
import { useAppInstallStore } from '../stores/appInstallStore';
import { useLicenseStore } from '../stores/licenseStore';
import { useUserStore } from '../stores/userStore';
import { formatDateTime } from '../utils/format';
import type { License, LicenseRenewalRequest } from '../openapi.d.ts';
import { AppInstallUnified } from '../types';

type TabKey = 'requests' | 'installs' | 'licenses' | 'renewals';

const ContractExplorerView: React.FC = () => {
    const { unifiedInstalls, fetchAll } = useAppInstallStore();
    const { licenses, fetchLicenses } = useLicenseStore();
    const { fetchUser } = useUserStore();

    const [activeTab, setActiveTab] = useState<TabKey>('requests');

    useEffect(() => {
        fetchUser();
        fetchAll();
        fetchLicenses();
        const intervalId = setInterval(() => {
            fetchAll();
            fetchLicenses();
        }, 5000);
        return () => clearInterval(intervalId);
    }, [fetchUser, fetchAll, fetchLicenses]);

    const requests = unifiedInstalls.filter(i => i.status === 'REQUEST');
    const installs = unifiedInstalls.filter(i => i.status === 'INSTALL');
    const allRenewals: (LicenseRenewalRequest & { licenseContractId: string })[] = licenses.flatMap(l =>
        (l.renewalRequests ?? []).map(r => ({ ...r, licenseContractId: l.contractId }))
    );

    const tabs: { key: TabKey; label: string; count: number }[] = [
        { key: 'requests', label: 'Install Requests', count: requests.length },
        { key: 'installs', label: 'Installs', count: installs.length },
        { key: 'licenses', label: 'Licenses', count: licenses.length },
        { key: 'renewals', label: 'Renewal Requests', count: allRenewals.length },
    ];

    return (
        <div>
            <h2>Contract Explorer</h2>
            <ul className="nav nav-tabs mb-3">
                {tabs.map(tab => (
                    <li className="nav-item" key={tab.key}>
                        <button
                            className={`nav-link${activeTab === tab.key ? ' active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}{' '}
                            <span className="badge bg-secondary">{tab.count}</span>
                        </button>
                    </li>
                ))}
            </ul>

            {activeTab === 'requests' && (
                <InstallRequestsTab rows={requests} />
            )}
            {activeTab === 'installs' && (
                <InstallsTab rows={installs} />
            )}
            {activeTab === 'licenses' && (
                <LicensesTab rows={licenses} />
            )}
            {activeTab === 'renewals' && (
                <RenewalRequestsTab rows={allRenewals} />
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <button
            className="btn btn-sm btn-link p-0 ms-1"
            title="Copy to clipboard"
            onClick={handleCopy}
            style={{ lineHeight: 1 }}
        >
            {copied ? '✓' : '⧉'}
        </button>
    );
};

const ContractIdCell: React.FC<{ contractId: string }> = ({ contractId }) => (
    <td className="ellipsis-cell" title={contractId} style={{ maxWidth: '220px' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '190px', verticalAlign: 'middle' }}>
            {contractId}
        </span>
        <CopyButton value={contractId} />
    </td>
);

// ---------------------------------------------------------------------------
// Tab: Install Requests
// ---------------------------------------------------------------------------

const InstallRequestsTab: React.FC<{ rows: AppInstallUnified[] }> = ({ rows }) => (
    <table className="table table-fixed" id="install-requests-table">
        <thead>
            <tr>
                <th style={{ width: '240px' }}>Contract ID</th>
                <th style={{ width: '180px' }}>User</th>
                <th style={{ width: '180px' }}>Provider</th>
                <th>Meta</th>
            </tr>
        </thead>
        <tbody>
            {rows.length === 0 && (
                <tr><td colSpan={4} className="text-center text-muted">No install requests</td></tr>
            )}
            {rows.map(r => (
                <tr key={r.contractId}>
                    <ContractIdCell contractId={r.contractId} />
                    <td className="ellipsis-cell">{r.user}</td>
                    <td className="ellipsis-cell">{r.provider}</td>
                    <td className="ellipsis-cell">{JSON.stringify(r.meta?.data ?? {})}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

// ---------------------------------------------------------------------------
// Tab: Installs
// ---------------------------------------------------------------------------

const InstallsTab: React.FC<{ rows: AppInstallUnified[] }> = ({ rows }) => (
    <table className="table table-fixed" id="installs-table">
        <thead>
            <tr>
                <th style={{ width: '240px' }}>Contract ID</th>
                <th style={{ width: '180px' }}>User</th>
                <th style={{ width: '180px' }}>Provider</th>
                <th style={{ width: '140px' }}>Licenses Created</th>
                <th style={{ width: '110px' }}>License #</th>
            </tr>
        </thead>
        <tbody>
            {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted">No installs</td></tr>
            )}
            {rows.map(r => (
                <tr key={r.contractId}>
                    <ContractIdCell contractId={r.contractId} />
                    <td className="ellipsis-cell">{r.user}</td>
                    <td className="ellipsis-cell">{r.provider}</td>
                    <td className="ellipsis-cell">{r.numLicensesCreated}</td>
                    <td className="ellipsis-cell">—</td>
                </tr>
            ))}
        </tbody>
    </table>
);

// ---------------------------------------------------------------------------
// Tab: Licenses
// ---------------------------------------------------------------------------

const LicensesTab: React.FC<{ rows: License[] }> = ({ rows }) => (
    <table className="table table-fixed" id="explorer-licenses-table">
        <thead>
            <tr>
                <th style={{ width: '240px' }}>Contract ID</th>
                <th style={{ width: '180px' }}>User</th>
                <th style={{ width: '180px' }}>Provider</th>
                <th style={{ width: '110px' }}>License #</th>
                <th style={{ width: '200px' }}>Expires At</th>
                <th style={{ width: '100px' }}>Status</th>
            </tr>
        </thead>
        <tbody>
            {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted">No licenses</td></tr>
            )}
            {rows.map(l => (
                <tr key={l.contractId}>
                    <ContractIdCell contractId={l.contractId} />
                    <td className="ellipsis-cell">{l.user}</td>
                    <td className="ellipsis-cell">{l.provider}</td>
                    <td className="ellipsis-cell">{l.licenseNum}</td>
                    <td className={`ellipsis-cell ${l.isExpired ? 'deadline-passed' : ''}`}>
                        {formatDateTime(l.expiresAt)}
                    </td>
                    <td className="ellipsis-cell">{l.isExpired ? 'EXPIRED' : 'ACTIVE'}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

// ---------------------------------------------------------------------------
// Tab: Renewal Requests
// ---------------------------------------------------------------------------

type RenewalRow = LicenseRenewalRequest & { licenseContractId: string };

const RenewalRequestsTab: React.FC<{ rows: RenewalRow[] }> = ({ rows }) => (
    <table className="table table-fixed" id="renewal-requests-table">
        <thead>
            <tr>
                <th style={{ width: '240px' }}>Contract ID</th>
                <th style={{ width: '110px' }}>License #</th>
                <th style={{ width: '130px' }}>Fee</th>
                <th style={{ width: '200px' }}>Prepare Until</th>
                <th style={{ width: '200px' }}>Settle Before</th>
                <th style={{ width: '120px' }}>Status</th>
            </tr>
        </thead>
        <tbody>
            {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-muted">No renewal requests</td></tr>
            )}
            {rows.map(r => {
                const status = r.settleDeadlinePassed
                    ? 'EXPIRED'
                    : r.allocationCid
                    ? 'ACCEPTED'
                    : 'PENDING';
                return (
                    <tr key={r.contractId}>
                        <ContractIdCell contractId={r.contractId} />
                        <td className="ellipsis-cell">{r.licenseNum}</td>
                        <td className="ellipsis-cell">{r.licenseFeeAmount} {r.licenseFeeInstrument}</td>
                        <td className={`ellipsis-cell ${r.prepareDeadlinePassed ? 'deadline-passed' : ''}`}>
                            {formatDateTime(r.prepareUntil)}
                        </td>
                        <td className={`ellipsis-cell ${r.settleDeadlinePassed ? 'deadline-passed' : ''}`}>
                            {formatDateTime(r.settleBefore)}
                        </td>
                        <td className="ellipsis-cell">{status}</td>
                    </tr>
                );
            })}
        </tbody>
    </table>
);

export default ContractExplorerView;
