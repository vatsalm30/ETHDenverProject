// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useToast } from './toastStore';
import api from '../api';
import { generateCommandId } from '../utils/commandId';
import { withErrorHandling } from '../utils/error';
import type {
    Client,
    InvoiceDto,
    FinancingAuctionDto,
    FinancedInvoiceDto,
    BankOwnershipDto,
    PaidInvoiceDto,
    CreateInvoiceRequest,
    StartAuctionRequest,
    CloseAuctionResult,
    BidStatusDto,
    PlaceBidRequest,
    PlaceBidResult,
    ParseInvoiceRequest,
    ParsedInvoiceDto,
} from '../openapi.d.ts';

// ── Bank trust score types (returned by GET /trust-score/bank/me) ────────────
export interface BankTrustScoreData {
    bank: string;
    tier: 'CERTIFIED' | 'PROBATIONARY' | 'SUSPENDED' | 'RATE_VIOLATION';
    certified: boolean;
    canBid: boolean;
    totalScore: number;
    reason: string;
    proofX_status: 'PASS' | 'FAIL';
    proofY_status: 'PASS' | 'FAIL' | 'PENDING';
    proofZ_status: 'PASS' | 'FAIL';
    proofX_points: number;
    proofY_points: number;
    proofZ_points: number;
    allProofsValid: boolean;
    timestamp: string;
}

// ── Trust score types (returned by GET /trust-score/supplier/me) ─────────────
export interface TrustScoreData {
    supplier: string;
    tier: 'PLATINUM' | 'GOLD' | 'SILVER' | 'UNRATED' | 'PROVISIONAL';
    certified: boolean;
    totalScore: number;
    maxPossibleScore: number;
    pendingCount: number;
    reason: string;
    invoiceValueCap: number | null;
    proof1_status: 'PASS' | 'FAIL';
    proof2_status: 'PASS' | 'FAIL' | 'PENDING';
    proof3_status: 'PASS' | 'FAIL' | 'PENDING';
    proof4_status: 'PASS' | 'FAIL' | 'PENDING';
    proof1_points: number;
    proof2_points: number;
    proof3_points: number;
    proof4_points: number;
    allProofsValid: boolean;
    timestamp: string;
}

// ── Buyer trust score types ───────────────────────────────────────────────────
export interface BuyerTrustScoreData {
    buyer: string;
    tier: 'PLATINUM' | 'GOLD' | 'SILVER' | 'UNRATED' | 'PROVISIONAL';
    certified: boolean;
    totalScore: number;
    maxPossibleScore: number;
    pendingCount: number;
    reason: string;
    proof1_status: 'PASS' | 'FAIL' | 'PENDING';
    proof2_status: 'PASS' | 'FAIL' | 'PENDING';
    proof3_status: 'PASS' | 'FAIL' | 'PENDING';
    proof4_status: 'PASS' | 'FAIL' | 'PENDING';
    proof1_points: number;
    proof2_points: number;
    proof3_points: number;
    proof4_points: number;
    allProofsValid: boolean;
    timestamp: string;
}

interface InvoiceFinanceState {
    invoices: InvoiceDto[];
    auctions: FinancingAuctionDto[];
    financedInvoices: FinancedInvoiceDto[];
    bankOwnerships: BankOwnershipDto[];
    paidInvoices: PaidInvoiceDto[];
    bidStatuses: Record<string, BidStatusDto>;
    trustScore: TrustScoreData | null;
    loadingTrust: boolean;
    bankScore: BankTrustScoreData | null;
    loadingBankScore: boolean;
    buyerScoreCache: Record<string, BuyerTrustScoreData>;
}

interface InvoiceFinanceContextType extends InvoiceFinanceState {
    fetchAll: () => Promise<void>;
    createInvoice: (req: CreateInvoiceRequest) => Promise<void>;
    confirmInvoice: (contractId: string) => Promise<void>;
    deleteInvoice: (contractId: string) => Promise<void>;
    startAuction: (contractId: string, req: StartAuctionRequest) => Promise<void>;
    cancelAuction: (contractId: string) => Promise<void>;
    closeAuction: (contractId: string) => Promise<CloseAuctionResult | null>;
    placeBid: (contractId: string, req: PlaceBidRequest) => Promise<PlaceBidResult | null>;
    getMyBidStatus: (contractId: string) => Promise<void>;
    payFinancedInvoice: (contractId: string) => Promise<void>;
    fetchTrustScore: () => Promise<void>;
    refreshTrustScore: () => Promise<void>;
    fetchBankScore: () => Promise<void>;
    refreshBankScore: () => Promise<void>;
    fetchBuyerScore: (buyerId: string) => Promise<BuyerTrustScoreData | null>;
    refreshBuyerScore: (buyerId: string) => Promise<BuyerTrustScoreData | null>;
    parseInvoice: (req: ParseInvoiceRequest) => Promise<ParsedInvoiceDto | null>;
}

const InvoiceFinanceContext = createContext<InvoiceFinanceContextType | undefined>(undefined);

export const InvoiceFinanceProvider = ({ children }: { children: React.ReactNode }) => {
    const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
    const [auctions, setAuctions] = useState<FinancingAuctionDto[]>([]);
    const [financedInvoices, setFinancedInvoices] = useState<FinancedInvoiceDto[]>([]);
    const [bankOwnerships, setBankOwnerships] = useState<BankOwnershipDto[]>([]);
    const [paidInvoices, setPaidInvoices] = useState<PaidInvoiceDto[]>([]);
    const [bidStatuses, setBidStatuses] = useState<Record<string, BidStatusDto>>({});
    const [trustScore, setTrustScore] = useState<TrustScoreData | null>(null);
    const [loadingTrust, setLoadingTrust] = useState(false);
    const [bankScore, setBankScore] = useState<BankTrustScoreData | null>(null);
    const [loadingBankScore, setLoadingBankScore] = useState(false);
    const [buyerScoreCache, setBuyerScoreCache] = useState<Record<string, BuyerTrustScoreData>>({});
    const toast = useToast();

    const fetchTrustScore = useCallback(async () => {
        setLoadingTrust(true);
        try {
            const resp = await fetch('/api/trust-score/supplier/me');
            if (resp.ok) setTrustScore(await resp.json());
        } catch (e) {
            console.warn('fetchTrustScore failed', e);
        } finally {
            setLoadingTrust(false);
        }
    }, []);

    const refreshTrustScore = useCallback(async () => {
        setLoadingTrust(true);
        try {
            const resp = await fetch('/api/trust-score/supplier/me/refresh', { method: 'POST' });
            if (resp.ok) setTrustScore(await resp.json());
        } catch (e) {
            console.warn('refreshTrustScore failed', e);
        } finally {
            setLoadingTrust(false);
        }
    }, []);

    const fetchBankScore = useCallback(async () => {
        setLoadingBankScore(true);
        try {
            const resp = await fetch('/api/trust-score/bank/me');
            if (resp.ok) setBankScore(await resp.json());
        } catch (e) {
            console.warn('fetchBankScore failed', e);
        } finally {
            setLoadingBankScore(false);
        }
    }, []);

    const refreshBankScore = useCallback(async () => {
        setLoadingBankScore(true);
        try {
            const resp = await fetch('/api/trust-score/bank/me/refresh', { method: 'POST' });
            if (resp.ok) setBankScore(await resp.json());
        } catch (e) {
            console.warn('refreshBankScore failed', e);
        } finally {
            setLoadingBankScore(false);
        }
    }, []);

    const fetchBuyerScore = useCallback(async (buyerId: string): Promise<BuyerTrustScoreData | null> => {
        try {
            const resp = await fetch(`/api/trust-score/buyer/${encodeURIComponent(buyerId)}`);
            if (resp.ok) {
                const data: BuyerTrustScoreData = await resp.json();
                setBuyerScoreCache(prev => ({ ...prev, [buyerId]: data }));
                return data;
            }
        } catch (e) {
            console.warn('fetchBuyerScore failed', e);
        }
        return null;
    }, []);

    const refreshBuyerScore = useCallback(async (buyerId: string): Promise<BuyerTrustScoreData | null> => {
        try {
            const resp = await fetch(`/api/trust-score/buyer/${encodeURIComponent(buyerId)}/refresh`, { method: 'POST' });
            if (resp.ok) {
                const data: BuyerTrustScoreData = await resp.json();
                setBuyerScoreCache(prev => ({ ...prev, [buyerId]: data }));
                return data;
            }
        } catch (e) {
            console.warn('refreshBuyerScore failed', e);
        }
        return null;
    }, []);

    const fetchAll = useCallback(
        withErrorHandling('Fetching invoice finance data')(async () => {
            const client: Client = await api.getClient();
            const [inv, auc, fin, bo, paid] = await Promise.allSettled([
                client.listInvoices(),
                client.listAuctions(),
                client.listFinancedInvoices(),
                client.listBankOwnerships(),
                client.listPaidInvoices(),
            ]);
            if (inv.status === 'fulfilled') setInvoices(inv.value.data);
            if (auc.status === 'fulfilled') setAuctions(auc.value.data);
            if (fin.status === 'fulfilled') setFinancedInvoices(fin.value.data);
            if (bo.status === 'fulfilled') setBankOwnerships(bo.value.data);
            if (paid.status === 'fulfilled') setPaidInvoices(paid.value.data);
        }),
        [toast]
    );

    const createInvoice = useCallback(
        withErrorHandling('Creating invoice')(async (req: CreateInvoiceRequest) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.createInvoice({ commandId }, req);
            await fetchAll();
            toast.displaySuccess(`Invoice ${req.invoiceId} created successfully`);
        }),
        [fetchAll, toast]
    );

    const confirmInvoice = useCallback(
        withErrorHandling('Confirming invoice')(async (contractId: string) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.confirmInvoice({ contractId, commandId });
            await fetchAll();
            toast.displaySuccess('Invoice confirmed');
        }),
        [fetchAll, toast]
    );

    const deleteInvoice = useCallback(
        withErrorHandling('Deleting invoice')(async (contractId: string) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.deleteInvoice({ contractId, commandId });
            await fetchAll();
            toast.displaySuccess('Invoice deleted');
        }),
        [fetchAll, toast]
    );

    const startAuction = useCallback(
        withErrorHandling('Starting auction')(async (contractId: string, req: StartAuctionRequest) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.startAuction({ contractId, commandId }, req);
            await fetchAll();
            toast.displaySuccess('Auction started! Institutions can now place bids.');
        }),
        [fetchAll, toast]
    );

    const cancelAuction = useCallback(
        withErrorHandling('Cancelling auction')(async (contractId: string) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.cancelAuction({ contractId, commandId });
            await fetchAll();
            toast.displaySuccess('Auction cancelled');
        }),
        [fetchAll, toast]
    );

    const closeAuction = useCallback(async (contractId: string): Promise<CloseAuctionResult | null> => {
        try {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            const result = await client.closeAuction({ contractId, commandId });
            await fetchAll();
            if (result.data.noWinner) {
                toast.displaySuccess('Auction closed — no bids were placed. Auction cancelled.');
            } else {
                toast.displaySuccess(
                    `Auction settled! Winner: ${result.data.winningInstitutionDisplayName ?? result.data.winningInstitutionPartyId} at ${result.data.winningRate?.toFixed(2)}%`
                );
            }
            return result.data;
        } catch (e) {
            console.error('closeAuction failed', e);
            toast.displayError('Failed to close auction');
            return null;
        }
    }, [fetchAll, toast]);

    const placeBid = useCallback(async (contractId: string, req: PlaceBidRequest): Promise<PlaceBidResult | null> => {
        try {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            const result = await client.placeBid({ contractId, commandId }, req);
            // Update bid status for this auction
            setBidStatuses(prev => ({
                ...prev,
                [contractId]: {
                    hasBid: true,
                    isWinning: result.data.isCurrentBestBid,
                    myRate: req.offeredRate,
                    currentBestRate: result.data.currentBestRate,
                },
            }));
            if (result.data.isCurrentBestBid) {
                toast.displaySuccess(`Bid placed at ${req.offeredRate.toFixed(2)}% — you have the best offer!`);
            } else {
                toast.displaySuccess(`Bid placed at ${req.offeredRate.toFixed(2)}%. Current best: ${result.data.currentBestRate.toFixed(2)}%`);
            }
            return result.data;
        } catch (e) {
            console.error('placeBid failed', e);
            toast.displayError('Failed to place bid');
            return null;
        }
    }, [toast]);

    const getMyBidStatus = useCallback(async (contractId: string): Promise<void> => {
        try {
            const client: Client = await api.getClient();
            const result = await client.getMyBidStatus({ contractId });
            setBidStatuses(prev => ({ ...prev, [contractId]: result.data }));
        } catch (e) {
            console.error('getMyBidStatus failed', e);
        }
    }, []);

    const payFinancedInvoice = useCallback(
        withErrorHandling('Paying invoice')(async (contractId: string) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.payFinancedInvoice({ contractId, commandId });
            await fetchAll();
            toast.displaySuccess('Invoice paid!');
        }),
        [fetchAll, toast]
    );

    const parseInvoice = useCallback(async (req: ParseInvoiceRequest): Promise<ParsedInvoiceDto | null> => {
        try {
            const client: Client = await api.getClient();
            const result = await client.parseInvoice(null, req);
            return result.data;
        } catch (e) {
            console.error('parseInvoice failed', e);
            return null;
        }
    }, []);

    return (
        <InvoiceFinanceContext.Provider value={{
            invoices,
            auctions,
            financedInvoices,
            bankOwnerships,
            paidInvoices,
            bidStatuses,
            trustScore,
            loadingTrust,
            bankScore,
            loadingBankScore,
            buyerScoreCache,
            fetchAll,
            createInvoice,
            confirmInvoice,
            deleteInvoice,
            startAuction,
            cancelAuction,
            closeAuction,
            placeBid,
            getMyBidStatus,
            payFinancedInvoice,
            fetchTrustScore,
            refreshTrustScore,
            fetchBankScore,
            refreshBankScore,
            fetchBuyerScore,
            refreshBuyerScore,
            parseInvoice,
        }}>
            {children}
        </InvoiceFinanceContext.Provider>
    );
};

export const useInvoiceFinance = () => {
    const ctx = useContext(InvoiceFinanceContext);
    if (!ctx) throw new Error('useInvoiceFinance must be used within InvoiceFinanceProvider');
    return ctx;
};
