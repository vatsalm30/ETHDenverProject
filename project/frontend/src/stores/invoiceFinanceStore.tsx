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
    GrabAuctionRequest,
    GrabAuctionResult,
    SprintBoostRequest,
} from '../openapi.d.ts';

interface InvoiceFinanceState {
    invoices: InvoiceDto[];
    auctions: FinancingAuctionDto[];
    financedInvoices: FinancedInvoiceDto[];
    bankOwnerships: BankOwnershipDto[];
    paidInvoices: PaidInvoiceDto[];
    lastGrabResult: GrabAuctionResult | null;
    auctionCountdown: number;      // seconds remaining in active auction
    auctionCurrentRate: number;    // live falling rate
}

interface InvoiceFinanceContextType extends InvoiceFinanceState {
    fetchAll: () => Promise<void>;
    createInvoice: (req: CreateInvoiceRequest) => Promise<void>;
    confirmInvoice: (contractId: string) => Promise<void>;
    startAuction: (contractId: string, req: StartAuctionRequest) => Promise<void>;
    grabAuction: (contractId: string, req: GrabAuctionRequest) => Promise<GrabAuctionResult | void>;
    cancelAuction: (contractId: string) => Promise<void>;
    payFinancedInvoice: (contractId: string) => Promise<void>;
    activateSprintBoost: (contractId: string, req: SprintBoostRequest) => Promise<void>;
}

const InvoiceFinanceContext = createContext<InvoiceFinanceContextType | undefined>(undefined);

export const InvoiceFinanceProvider = ({ children }: { children: React.ReactNode }) => {
    const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
    const [auctions, setAuctions] = useState<FinancingAuctionDto[]>([]);
    const [financedInvoices, setFinancedInvoices] = useState<FinancedInvoiceDto[]>([]);
    const [bankOwnerships, setBankOwnerships] = useState<BankOwnershipDto[]>([]);
    const [paidInvoices, setPaidInvoices] = useState<PaidInvoiceDto[]>([]);
    const [lastGrabResult, setLastGrabResult] = useState<GrabAuctionResult | null>(null);
    const [auctionCountdown, setAuctionCountdown] = useState(0);
    const [auctionCurrentRate, setAuctionCurrentRate] = useState(0);
    const toast = useToast();

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
            if (auc.status === 'fulfilled') {
                setAuctions(auc.value.data);
                // Kick off live countdown for open auctions
                const openAuctions = auc.value.data.filter(a => a.status === 'OPEN');
                if (openAuctions.length > 0) {
                    const first = openAuctions[0];
                    setAuctionCurrentRate(first.startRate);
                    setAuctionCountdown(first.auctionDurationSecs);
                }
            }
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
            toast.displaySuccess('Invoice confirmed — buyer acknowledges delivery');
        }),
        [fetchAll, toast]
    );

    const startAuction = useCallback(
        withErrorHandling('Starting auction')(async (contractId: string, req: StartAuctionRequest) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.startAuction({ contractId, commandId }, req);
            await fetchAll();
            toast.displaySuccess('Dutch auction started! Banks can now bid.');
        }),
        [fetchAll, toast]
    );

    const grabAuction = useCallback(
        withErrorHandling('Grabbing auction')(async (contractId: string, req: GrabAuctionRequest) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            const result = await client.grabAuction({ contractId, commandId }, req);
            setLastGrabResult(result.data);
            await fetchAll();
            toast.displaySuccess(
                `🏆 Won at ${result.data.purchaseRate?.toFixed(2)}% — $${result.data.purchaseAmount?.toLocaleString()} paid to supplier`
            );
            return result.data;
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

    const payFinancedInvoice = useCallback(
        withErrorHandling('Paying invoice')(async (contractId: string) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.payFinancedInvoice({ contractId, commandId });
            await fetchAll();
            toast.displaySuccess('Invoice paid! 🎉');
        }),
        [fetchAll, toast]
    );

    const activateSprintBoost = useCallback(
        withErrorHandling('Activating Sprint Boost')(async (contractId: string, req: SprintBoostRequest) => {
            const client: Client = await api.getClient();
            const commandId = generateCommandId();
            await client.activateSprintBoost({ contractId, commandId }, req);
            await fetchAll();
            toast.displaySuccess(`🚀 Sprint Boost activated! Paying early earns you $${req.bountyAmount.toLocaleString()} bounty`);
        }),
        [fetchAll, toast]
    );

    return (
        <InvoiceFinanceContext.Provider value={{
            invoices,
            auctions,
            financedInvoices,
            bankOwnerships,
            paidInvoices,
            lastGrabResult,
            auctionCountdown,
            auctionCurrentRate,
            fetchAll,
            createInvoice,
            confirmInvoice,
            startAuction,
            grabAuction,
            cancelAuction,
            payFinancedInvoice,
            activateSprintBoost,
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
