// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import static com.digitalasset.quickstart.service.ServiceUtils.ensurePresent;
import static com.digitalasset.quickstart.service.ServiceUtils.traceServiceCallAsync;
import static com.digitalasset.quickstart.utility.TracingUtils.tracingCtx;

import com.digitalasset.quickstart.api.*;
import com.digitalasset.quickstart.ledger.LedgerApi;
import com.digitalasset.quickstart.repository.DamlRepository;
import com.digitalasset.quickstart.security.AuthUtils;
import com.digitalasset.transcode.java.Party;
import io.opentelemetry.instrumentation.annotations.WithSpan;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import org.openapitools.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

// Generated Daml Java bindings (available after `./gradlew :daml:codeGen`)
import quickstart_invoice_finance.invoicefinance.core.Invoice;
import quickstart_invoice_finance.invoicefinance.core.Invoice.Invoice_BuyerConfirm;
import quickstart_invoice_finance.invoicefinance.core.Invoice.Invoice_StartAuction;
import quickstart_invoice_finance.invoicefinance.core.FinancingAuction;
import quickstart_invoice_finance.invoicefinance.core.FinancingAuction.FinancingAuction_BankGrab;
import quickstart_invoice_finance.invoicefinance.core.FinancingAuction.FinancingAuction_Cancel;
import quickstart_invoice_finance.invoicefinance.core.WinningBid;
import quickstart_invoice_finance.invoicefinance.core.WinningBid.WinningBid_Settle;
import quickstart_invoice_finance.invoicefinance.core.FinancedInvoice;
import quickstart_invoice_finance.invoicefinance.core.FinancedInvoice.FinancedInvoice_ActivateSprintBoost;
import quickstart_invoice_finance.invoicefinance.core.FinancedInvoice.FinancedInvoice_Pay;
import quickstart_invoice_finance.invoicefinance.core.BankOwnership;
import quickstart_invoice_finance.invoicefinance.core.PaidInvoice;
import quickstart_invoice_finance.invoicefinance.core.FinancedInvoiceResult;

/**
 * Deadline Derby — Invoice Finance REST controller.
 *
 * <p>Privacy model enforced at the Daml contract level:
 * <ul>
 *   <li>Losing banks never see WinningBid or BankOwnership contracts.</li>
 *   <li>Buyers never see BankOwnership (purchase rate / margin stays private).</li>
 *   <li>FinancedInvoice is visible to all trade parties but does NOT expose the purchase rate.</li>
 *   <li>SprintBoostOffer is a private negotiation between buyer and bank only.</li>
 * </ul>
 */
@Controller
@RequestMapping("${openapi.asset.base-path:}")
public class InvoiceFinanceApiImpl implements
        InvoicesApi,
        AuctionsApi,
        FinancedInvoicesApi,
        BankOwnershipsApi,
        PaidInvoicesApi {

    private static final Logger logger = LoggerFactory.getLogger(InvoiceFinanceApiImpl.class);

    private final LedgerApi ledger;
    private final AuthUtils auth;
    private final DamlRepository damlRepository;

    @Autowired
    public InvoiceFinanceApiImpl(LedgerApi ledger, AuthUtils auth, DamlRepository damlRepository) {
        this.ledger = ledger;
        this.auth = auth;
        this.damlRepository = damlRepository;
    }

    // ─── Invoices ───────────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<InvoiceDto>>> listInvoices() {
        var ctx = tracingCtx(logger, "listInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveInvoices(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream().map(this::toInvoiceDto).toList())
                )
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<InvoiceDto>> createInvoice(
            String commandId,
            CreateInvoiceRequest req
    ) {
        var ctx = tracingCtx(logger, "createInvoice", "commandId", commandId, "invoiceId", req.getInvoiceId());
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            var entity = new Invoice(
                    new Party(auth.getAppProviderPartyId()), // operator
                    new Party(party),                         // supplier = caller
                    new Party(req.getBuyerParty()),
                    req.getInvoiceId(),
                    BigDecimal.valueOf(req.getAmount()),
                    req.getDescription(),
                    (long) req.getPaymentTermDays(),
                    req.getIssueDate(),
                    req.getDueDate(),
                    "PENDING_CONFIRMATION"
            );
            return ledger.create(entity, commandId).thenApply(v -> {
                var dto = new InvoiceDto();
                dto.setOperator(auth.getAppProviderPartyId());
                dto.setSupplier(party);
                dto.setBuyer(req.getBuyerParty());
                dto.setInvoiceId(req.getInvoiceId());
                dto.setAmount(req.getAmount());
                dto.setDescription(req.getDescription());
                dto.setPaymentTermDays(req.getPaymentTermDays());
                dto.setIssueDate(req.getIssueDate());
                dto.setDueDate(req.getDueDate());
                dto.setStatus(InvoiceDto.StatusEnum.PENDING_CONFIRMATION);
                return ResponseEntity.status(HttpStatus.CREATED).body(dto);
            });
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<InvoiceDto>> confirmInvoice(String contractId, String commandId) {
        var ctx = tracingCtx(logger, "confirmInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findInvoiceById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "Invoice not found: %s", contractId);
                    var choice = new Invoice_BuyerConfirm();
                    return ledger.exerciseAndGetResult(contract.contractId, choice, commandId)
                            .thenApply(newCid -> {
                                var dto = toInvoiceDto(contract);
                                dto.setStatus(InvoiceDto.StatusEnum.CONFIRMED);
                                dto.setContractId(newCid.getContractId);
                                return ResponseEntity.ok(dto);
                            });
                })
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<FinancingAuctionDto>> startAuction(
            String contractId,
            String commandId,
            StartAuctionRequest req
    ) {
        var ctx = tracingCtx(logger, "startAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findInvoiceById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "Invoice not found: %s", contractId);
                    var choice = new Invoice_StartAuction(
                            req.getEligibleBanks().stream()
                                    .map(Party::new)
                                    .toList(),
                            BigDecimal.valueOf(req.getStartRate()),
                            BigDecimal.valueOf(req.getReserveRate()),
                            req.getAuctionDurationSecs().longValue()
                    );
                    return ledger.exerciseAndGetResult(contract.contractId, choice, commandId)
                            .thenApply(auctionCid -> {
                                var dto = new FinancingAuctionDto();
                                dto.setContractId(auctionCid.getContractId);
                                dto.setOperator(contract.payload.getOperator.getParty);
                                dto.setSupplier(contract.payload.getSupplier.getParty);
                                dto.setBuyer(contract.payload.getBuyer.getParty);
                                dto.setInvoiceId(contract.payload.getInvoiceId);
                                dto.setAmount(contract.payload.getAmount.doubleValue());
                                dto.setDescription(contract.payload.getDescription);
                                dto.setDueDate(contract.payload.getDueDate);
                                dto.setStartRate(req.getStartRate());
                                dto.setReserveRate(req.getReserveRate());
                                dto.setAuctionDurationSecs(req.getAuctionDurationSecs());
                                dto.setEligibleBanks(req.getEligibleBanks());
                                dto.setStatus(FinancingAuctionDto.StatusEnum.OPEN);
                                return ResponseEntity.status(HttpStatus.CREATED).body(dto);
                            });
                })
        ));
    }

    // ─── Auctions ───────────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<FinancingAuctionDto>>> listAuctions() {
        var ctx = tracingCtx(logger, "listAuctions");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveAuctions(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream().map(c -> {
                            var dto = new FinancingAuctionDto();
                            dto.setContractId(c.contractId.getContractId);
                            dto.setOperator(c.payload.getOperator.getParty);
                            dto.setSupplier(c.payload.getSupplier.getParty);
                            dto.setBuyer(c.payload.getBuyer.getParty);
                            dto.setInvoiceId(c.payload.getInvoiceId);
                            dto.setAmount(c.payload.getAmount.doubleValue());
                            dto.setDescription(c.payload.getDescription);
                            dto.setDueDate(c.payload.getDueDate);
                            dto.setStartRate(c.payload.getStartRate.doubleValue());
                            dto.setReserveRate(c.payload.getReserveRate.doubleValue());
                            dto.setAuctionDurationSecs(c.payload.getAuctionDurationSecs.intValue());
                            dto.setEligibleBanks(c.payload.getEligibleBanks.stream()
                                    .map(p -> p.getParty).toList());
                            dto.setStatus(FinancingAuctionDto.StatusEnum.fromValue(c.payload.getStatus));
                            return dto;
                        }).toList())
                )
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<GrabAuctionResult>> grabAuction(
            String contractId,
            String commandId,
            GrabAuctionRequest req
    ) {
        var ctx = tracingCtx(logger, "grabAuction", "contractId", contractId, "commandId", commandId,
                "bankParty", req.getBankParty(), "offeredRate", req.getOfferedRate());
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                    var auctionContract = ensurePresent(opt, "Auction not found: %s", contractId);
                    var grabChoice = new FinancingAuction_BankGrab(
                            new Party(req.getBankParty()),
                            BigDecimal.valueOf(req.getOfferedRate())
                    );
                    // Step 1: bank grabs → creates WinningBid
                    return ledger.exerciseAndGetResult(auctionContract.contractId, grabChoice, commandId)
                            .thenComposeAsync(winningBidCid -> {
                                // Step 2: immediately settle the WinningBid → FinancedInvoice + BankOwnership
                                var settleChoice = new WinningBid_Settle();
                                String settleCommandId = commandId + "-settle";
                                return ledger.exerciseAndGetResult(winningBidCid, settleChoice, settleCommandId)
                                        .thenApply(result -> {
                                            var r = new GrabAuctionResult();
                                            r.setWinningBidContractId(winningBidCid.getContractId);
                                            r.setFinancedInvoiceContractId(
                                                    result.getFinancedInvoiceId.getContractId);
                                            r.setBankOwnershipContractId(
                                                    result.getBankOwnershipId.getContractId);
                                            r.setPurchaseRate(req.getOfferedRate());
                                            r.setPurchaseAmount(
                                                    auctionContract.payload.getAmount.doubleValue()
                                                            * req.getOfferedRate() / 100.0);
                                            return ResponseEntity.status(HttpStatus.CREATED).body(r);
                                        });
                            });
                })
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<Void>> cancelAuction(String contractId, String commandId) {
        var ctx = tracingCtx(logger, "cancelAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "Auction not found: %s", contractId);
                    var choice = new FinancingAuction_Cancel();
                    return ledger.exerciseAndGetResult(contract.contractId, choice, commandId)
                            .thenApply(v -> ResponseEntity.<Void>noContent().build());
                })
        ));
    }

    // ─── Financed Invoices ──────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<FinancedInvoiceDto>>> listFinancedInvoices() {
        var ctx = tracingCtx(logger, "listFinancedInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveFinancedInvoices(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream().map(this::toFinancedInvoiceDto).toList())
                )
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<PaidInvoiceDto>> payFinancedInvoice(
            String contractId, String commandId) {
        var ctx = tracingCtx(logger, "payFinancedInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findFinancedInvoiceById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "FinancedInvoice not found: %s", contractId);
                    var choice = new FinancedInvoice_Pay();
                    return ledger.exerciseAndGetResult(contract.contractId, choice, commandId)
                            .thenApply(paidCid -> {
                                var dto = new PaidInvoiceDto();
                                dto.setContractId(paidCid.getContractId);
                                dto.setOperator(contract.payload.getOperator.getParty);
                                dto.setSupplier(contract.payload.getSupplier.getParty);
                                dto.setBuyer(contract.payload.getBuyer.getParty);
                                dto.setBank(contract.payload.getBank.getParty);
                                dto.setInvoiceId(contract.payload.getInvoiceId);
                                dto.setAmount(contract.payload.getAmount.doubleValue());
                                dto.setDescription(contract.payload.getDescription);
                                dto.setSprintBoosted(contract.payload.isSprintBoostActive);
                                dto.setBountyPaid(contract.payload.getSprintBoostBounty.doubleValue());
                                return ResponseEntity.ok(dto);
                            });
                })
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<FinancedInvoiceDto>> activateSprintBoost(
            String contractId,
            String commandId,
            SprintBoostRequest req
    ) {
        var ctx = tracingCtx(logger, "activateSprintBoost", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findFinancedInvoiceById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "FinancedInvoice not found: %s", contractId);
                    var choice = new FinancedInvoice_ActivateSprintBoost(
                            BigDecimal.valueOf(req.getBountyAmount()));
                    return ledger.exerciseAndGetResult(contract.contractId, choice, commandId)
                            .thenApply(newCid -> {
                                var dto = toFinancedInvoiceDto(contract);
                                dto.setContractId(newCid.getContractId);
                                dto.setSprintBoostActive(true);
                                dto.setSprintBoostBounty(req.getBountyAmount());
                                dto.setPaymentStatus(FinancedInvoiceDto.PaymentStatusEnum.SPRINT_BOOST_ACTIVE);
                                return ResponseEntity.ok(dto);
                            });
                })
        ));
    }

    // ─── Bank Ownerships (confidential — buyer excluded) ────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<BankOwnershipDto>>> listBankOwnerships() {
        var ctx = tracingCtx(logger, "listBankOwnerships");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveBankOwnerships(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream().map(c -> {
                            var dto = new BankOwnershipDto();
                            dto.setContractId(c.contractId.getContractId);
                            dto.setOperator(c.payload.getOperator.getParty);
                            dto.setBank(c.payload.getBank.getParty);
                            dto.setInvoiceId(c.payload.getInvoiceId);
                            dto.setPurchaseRate(c.payload.getPurchaseRate.doubleValue());
                            dto.setPurchaseAmount(c.payload.getPurchaseAmount.doubleValue());
                            dto.setFaceValue(c.payload.getFaceValue.doubleValue());
                            return dto;
                        }).toList())
                )
        ));
    }

    // ─── Paid Invoices ───────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<PaidInvoiceDto>>> listPaidInvoices() {
        var ctx = tracingCtx(logger, "listPaidInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findPaidInvoices(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream().map(c -> {
                            var dto = new PaidInvoiceDto();
                            dto.setContractId(c.contractId.getContractId);
                            dto.setOperator(c.payload.getOperator.getParty);
                            dto.setSupplier(c.payload.getSupplier.getParty);
                            dto.setBuyer(c.payload.getBuyer.getParty);
                            dto.setBank(c.payload.getBank.getParty);
                            dto.setInvoiceId(c.payload.getInvoiceId);
                            dto.setAmount(c.payload.getAmount.doubleValue());
                            dto.setDescription(c.payload.getDescription);
                            dto.setSprintBoosted(c.payload.isSprintBoosted);
                            dto.setBountyPaid(c.payload.getBountyPaid.doubleValue());
                            return dto;
                        }).toList())
                )
        ));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private InvoiceDto toInvoiceDto(com.digitalasset.quickstart.pqs.Contract<Invoice> c) {
        var dto = new InvoiceDto();
        dto.setContractId(c.contractId.getContractId);
        dto.setOperator(c.payload.getOperator.getParty);
        dto.setSupplier(c.payload.getSupplier.getParty);
        dto.setBuyer(c.payload.getBuyer.getParty);
        dto.setInvoiceId(c.payload.getInvoiceId);
        dto.setAmount(c.payload.getAmount.doubleValue());
        dto.setDescription(c.payload.getDescription);
        dto.setPaymentTermDays(c.payload.getPaymentTermDays.intValue());
        dto.setIssueDate(c.payload.getIssueDate);
        dto.setDueDate(c.payload.getDueDate);
        dto.setStatus(InvoiceDto.StatusEnum.fromValue(c.payload.getStatus));
        return dto;
    }

    private FinancedInvoiceDto toFinancedInvoiceDto(com.digitalasset.quickstart.pqs.Contract<FinancedInvoice> c) {
        var dto = new FinancedInvoiceDto();
        dto.setContractId(c.contractId.getContractId);
        dto.setOperator(c.payload.getOperator.getParty);
        dto.setSupplier(c.payload.getSupplier.getParty);
        dto.setBuyer(c.payload.getBuyer.getParty);
        dto.setBank(c.payload.getBank.getParty);
        dto.setInvoiceId(c.payload.getInvoiceId);
        dto.setAmount(c.payload.getAmount.doubleValue());
        dto.setDescription(c.payload.getDescription);
        dto.setDueDate(c.payload.getDueDate);
        dto.setPaymentStatus(FinancedInvoiceDto.PaymentStatusEnum.fromValue(c.payload.getPaymentStatus));
        dto.setSprintBoostActive(c.payload.isSprintBoostActive);
        dto.setSprintBoostBounty(c.payload.getSprintBoostBounty.doubleValue());
        return dto;
    }
}
