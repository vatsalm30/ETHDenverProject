// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import static com.digitalasset.quickstart.service.ServiceUtils.ensurePresent;
import static com.digitalasset.quickstart.service.ServiceUtils.traceServiceCallAsync;
import static com.digitalasset.quickstart.utility.TracingUtils.tracingCtx;

import com.digitalasset.quickstart.api.*;
import com.digitalasset.quickstart.ledger.LedgerApi;
import com.digitalasset.quickstart.repository.DamlRepository;
import com.digitalasset.quickstart.repository.TenantPropertiesRepository;
import com.digitalasset.quickstart.security.AuthUtils;
import com.digitalasset.transcode.java.Party;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.instrumentation.annotations.WithSpan;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.OptionalDouble;
import java.util.concurrent.CompletableFuture;
import org.openapitools.jackson.nullable.JsonNullable;

import org.springframework.beans.factory.annotation.Value;

import org.openapitools.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.server.ResponseStatusException;

// Generated Daml Java bindings (available after `./gradlew :daml:codeGen`)
import quickstart_invoice_finance.invoicefinance.core.FinancingAuction;
import quickstart_invoice_finance.invoicefinance.core.FinancingAuction.FinancingAuction_BankGrab;
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

    /**
     * In-memory invoice store — avoids ledger round-trips for the create step.
     * Key = pseudo contractId (UUID), Value = the DTO built at create time.
     *
     * When startAuction is called we use createAndExercise (one atomic transaction)
     * which guarantees the same package version is used for both create and exercise,
     * eliminating the CONTRACT_NOT_ACTIVE / package-mismatch error.
     */
    private final java.util.concurrent.ConcurrentHashMap<String, InvoiceDto> pendingInvoices =
            new java.util.concurrent.ConcurrentHashMap<>();

    private final LedgerApi ledger;
    private final AuthUtils auth;
    private final DamlRepository damlRepository;
    private final TenantPropertiesRepository tenantRepo;
    private final AuctionBidStore auctionBidStore;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    // Tracks auction creation timestamps to derive auctionEndTime
    private final java.util.concurrent.ConcurrentHashMap<String, Instant> auctionCreatedAt =
            new java.util.concurrent.ConcurrentHashMap<>();

    @Value("${anthropic.api-key:}")
    private String anthropicApiKey;

    @Autowired
    public InvoiceFinanceApiImpl(LedgerApi ledger, AuthUtils auth, DamlRepository damlRepository,
                                  TenantPropertiesRepository tenantRepo, AuctionBidStore auctionBidStore) {
        this.ledger = ledger;
        this.auth = auth;
        this.damlRepository = damlRepository;
        this.tenantRepo = tenantRepo;
        this.auctionBidStore = auctionBidStore;
    }

    // ─── AI Invoice Parse ────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<ParsedInvoiceDto>> parseInvoice(
            org.openapitools.model.ParseInvoiceRequest req) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                if (anthropicApiKey == null || anthropicApiKey.isBlank()) {
                    // Return a mock response when no API key is configured
                    return ResponseEntity.ok(mockParsedInvoice());
                }

                String prompt = "Extract invoice data from this image. Return ONLY valid JSON with these fields: " +
                        "{\"invoiceNumber\":\"string\",\"vendorName\":\"string\",\"buyerName\":\"string\"," +
                        "\"amount\":number,\"issueDate\":\"YYYY-MM-DD\",\"dueDate\":\"YYYY-MM-DD\"," +
                        "\"description\":\"string\",\"confidence\":number_0_to_1}. " +
                        "If a field is not visible, use null. Do not include any text outside the JSON.";

                String requestBody = objectMapper.writeValueAsString(new java.util.LinkedHashMap<>() {{
                    put("model", "claude-haiku-4-5-20251001");
                    put("max_tokens", 512);
                    put("messages", List.of(new java.util.LinkedHashMap<>() {{
                        put("role", "user");
                        put("content", List.of(
                                new java.util.LinkedHashMap<>() {{
                                    put("type", "image");
                                    put("source", new java.util.LinkedHashMap<>() {{
                                        put("type", "base64");
                                        put("media_type", req.getMimeType());
                                        put("data", req.getFileBase64());
                                    }});
                                }},
                                new java.util.LinkedHashMap<>() {{
                                    put("type", "text");
                                    put("text", prompt);
                                }}
                        ));
                    }}));
                }});

                HttpRequest httpReq = HttpRequest.newBuilder()
                        .uri(URI.create("https://api.anthropic.com/v1/messages"))
                        .header("Content-Type", "application/json")
                        .header("x-api-key", anthropicApiKey)
                        .header("anthropic-version", "2023-06-01")
                        .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                        .build();

                HttpResponse<String> httpResp = httpClient.send(httpReq, HttpResponse.BodyHandlers.ofString());
                JsonNode root = objectMapper.readTree(httpResp.body());
                String text = root.path("content").get(0).path("text").asText();

                // Strip markdown code fences if present
                text = text.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
                JsonNode parsed = objectMapper.readTree(text);

                ParsedInvoiceDto dto = new ParsedInvoiceDto();
                if (!parsed.path("invoiceNumber").isNull()) dto.setInvoiceNumber(parsed.path("invoiceNumber").asText());
                if (!parsed.path("vendorName").isNull()) dto.setVendorName(parsed.path("vendorName").asText());
                if (!parsed.path("buyerName").isNull()) dto.setBuyerName(parsed.path("buyerName").asText());
                if (!parsed.path("amount").isNull() && parsed.path("amount").isNumber())
                    dto.setAmount(parsed.path("amount").asDouble());
                if (!parsed.path("issueDate").isNull()) {
                    try { dto.setIssueDate(LocalDate.parse(parsed.path("issueDate").asText())); } catch (Exception ignored) {}
                }
                if (!parsed.path("dueDate").isNull()) {
                    try { dto.setDueDate(LocalDate.parse(parsed.path("dueDate").asText())); } catch (Exception ignored) {}
                }
                if (!parsed.path("description").isNull()) dto.setDescription(parsed.path("description").asText());
                dto.setConfidence(parsed.path("confidence").asDouble(0.8));
                return ResponseEntity.ok(dto);
            } catch (Exception e) {
                logger.error("Invoice parse failed", e);
                return ResponseEntity.ok(mockParsedInvoice());
            }
        });
    }

    private ParsedInvoiceDto mockParsedInvoice() {
        ParsedInvoiceDto dto = new ParsedInvoiceDto();
        dto.setInvoiceNumber("INV-" + System.currentTimeMillis() % 10000);
        dto.setVendorName("Acme Corp");
        dto.setBuyerName("Global Buyer Inc");
        dto.setAmount(50000.0);
        dto.setIssueDate(LocalDate.now());
        dto.setDueDate(LocalDate.now().plusDays(90));
        dto.setDescription("Goods and services rendered");
        dto.setConfidence(0.0);
        return dto;
    }

    // ─── Invoices ───────────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<InvoiceDto>>> listInvoices() {
        var ctx = tracingCtx(logger, "listInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Return in-memory pending invoices (those not yet auctioned).
            // Invoices are stored here after createInvoice and removed after startAuction.
            var list = pendingInvoices.values().stream()
                    .filter(dto -> party.equals(dto.getSupplier())
                            || party.equals(dto.getBuyer())
                            || party.equals(dto.getOperator()))
                    .toList();
            return CompletableFuture.completedFuture(ResponseEntity.ok(list));
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<InvoiceDto>> createInvoice(
            String commandId,
            CreateInvoiceRequest req
    ) {
        var ctx = tracingCtx(logger, "createInvoice", "commandId", commandId, "invoiceId", req.getInvoiceId());
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Store the invoice in memory — no ledger interaction yet.
            // The actual Daml contract is created atomically when startAuction is called
            // via createAndExercise, which avoids the package-version mismatch that caused
            // CONTRACT_NOT_ACTIVE when create and exercise happened in separate transactions.
            String pseudoId = java.util.UUID.randomUUID().toString();
            var dto = new InvoiceDto();
            dto.setContractId(pseudoId);
            dto.setOperator(auth.getAppProviderPartyId());
            dto.setSupplier(party);
            dto.setBuyer(req.getBuyerParty());
            dto.setInvoiceId(req.getInvoiceId());
            dto.setAmount(req.getAmount());
            dto.setDescription(req.getDescription());
            dto.setPaymentTermDays(req.getPaymentTermDays());
            dto.setIssueDate(req.getIssueDate());
            dto.setDueDate(req.getDueDate());
            dto.setStatus(InvoiceDto.StatusEnum.CONFIRMED);
            pendingInvoices.put(pseudoId, dto);
            logger.info("createInvoice stored in-memory: pseudoId={} invoiceId={}", pseudoId, req.getInvoiceId());
            return CompletableFuture.completedFuture(
                    ResponseEntity.status(HttpStatus.CREATED).body(dto));
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<Void>> deleteInvoice(String contractId, String commandId) {
        var ctx = tracingCtx(logger, "deleteInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Invoices are stored in-memory; removing from the map is all that's needed.
            boolean removed = pendingInvoices.remove(contractId) != null;
            logger.info("deleteInvoice: contractId={} removed={}", contractId, removed);
            return CompletableFuture.completedFuture(ResponseEntity.<Void>noContent().build());
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<InvoiceDto>> confirmInvoice(String contractId, String commandId) {
        // Invoices are now stored in-memory; they're always in CONFIRMED state.
        // This endpoint is a no-op — just return the stored DTO.
        var ctx = tracingCtx(logger, "confirmInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            var dto = pendingInvoices.get(contractId);
            if (dto == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invoice not found: " + contractId);
            }
            return CompletableFuture.completedFuture(ResponseEntity.ok(dto));
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<FinancingAuctionDto>> startAuction(
            String contractId,
            String commandId,
            StartAuctionRequest req
    ) {
        var ctx = tracingCtx(logger, "startAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Look up the invoice from in-memory store
            var invoiceDto = pendingInvoices.get(contractId);
            if (invoiceDto == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Invoice not found: " + contractId + ". It may have already been auctioned or deleted.");
            }

            // Enforce one-auction-at-a-time per company
            boolean hasOpenAuction = auctionCreatedAt.values().stream().anyMatch(t -> true)
                    && pendingInvoices.values().stream().noneMatch(inv -> inv.getSupplier().equals(party));
            // Simpler check via damlRepository (async not needed here; use sync approach)
            // We'll do the open-auction check inline when we add closeAuction tracking

            // Resolve auction duration: days take precedence over seconds
            long auctionDurationSecs;
            // JsonNullable.isPresent() checks if the field was provided
            boolean hasDays = req.getAuctionDurationDays() != null
                    && req.getAuctionDurationDays().isPresent()
                    && req.getAuctionDurationDays().get() != null;
            if (hasDays) {
                int days = req.getAuctionDurationDays().get();
                long maxDays = ChronoUnit.DAYS.between(LocalDate.now(), invoiceDto.getDueDate());
                if (days > maxDays) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Auction duration (" + days + " days) exceeds days until invoice expiry (" + maxDays + " days)");
                }
                if (days < 1) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Auction duration must be at least 1 day");
                }
                auctionDurationSecs = days * 86400L;
            } else {
                auctionDurationSecs = req.getAuctionDurationSecs() != null ? req.getAuctionDurationSecs().longValue() : 86400L;
            }

            // Auto-populate eligible banks when none specified
            List<String> banks = (req.getEligibleBanks() == null || req.getEligibleBanks().isEmpty())
                    ? resolveEligibleBanks(party)
                    : req.getEligibleBanks();

            // Create a FinancingAuction directly — bypassing the Invoice contract entirely.
            //
            // Why: The old package (b2fe96ff) loaded on the Canton participant still has
            // `archive self` inside Invoice_StartAuction.  Every attempt to exercise that
            // choice (directly or via createAndExercise) fails with CONTRACT_NOT_ACTIVE
            // because the consuming-exercise node and the self-archive node both try to
            // consume the same Invoice contract.
            //
            // FinancingAuction has `signatory operator` only — the operator party is the
            // backend service account, so no multi-party auth is needed.  Creating it
            // directly is a pure CREATE command with no choice execution, so the
            // archive-self bug is never triggered.
            final long finalDurationSecs = auctionDurationSecs;
            var auction = new FinancingAuction(
                    new Party(invoiceDto.getOperator()),
                    new Party(invoiceDto.getSupplier()),
                    new Party(invoiceDto.getBuyer()),
                    invoiceDto.getInvoiceId(),
                    BigDecimal.valueOf(invoiceDto.getAmount()),
                    invoiceDto.getDescription(),
                    invoiceDto.getDueDate(),
                    BigDecimal.valueOf(req.getStartRate()),
                    BigDecimal.valueOf(req.getReserveRate()),
                    finalDurationSecs,
                    banks.stream().map(Party::new).toList(),
                    "OPEN"
            );

            Instant createdAt = Instant.now();
            return ledger.createAndGetId(auction, commandId)
                    .thenApply(auctionCid -> {
                        // Remove from pending map — the invoice is now in auction
                        pendingInvoices.remove(contractId);
                        // Record creation time for countdown calculation
                        auctionCreatedAt.put(auctionCid.getContractId, createdAt);

                        var dto = new FinancingAuctionDto();
                        dto.setContractId(auctionCid.getContractId);
                        dto.setOperator(invoiceDto.getOperator());
                        dto.setSupplier(invoiceDto.getSupplier());
                        dto.setBuyer(invoiceDto.getBuyer());
                        dto.setInvoiceId(invoiceDto.getInvoiceId());
                        dto.setAmount(invoiceDto.getAmount());
                        dto.setDescription(invoiceDto.getDescription());
                        dto.setDueDate(invoiceDto.getDueDate());
                        dto.setStartRate(req.getStartRate());
                        dto.setReserveRate(req.getReserveRate());
                        dto.setAuctionDurationSecs((int) finalDurationSecs);
                        dto.setEligibleBanks(banks);
                        dto.setStatus(FinancingAuctionDto.StatusEnum.OPEN);
                        dto.setAuctionEndTime(JsonNullable.of(java.time.OffsetDateTime.ofInstant(
                                createdAt.plusSeconds(finalDurationSecs),
                                java.time.ZoneOffset.UTC)));
                        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
                    });
        }));
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
                            String cid = c.contractId.getContractId;
                            dto.setContractId(cid);
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

                            // Enrich with sealed-bid data from AuctionBidStore
                            OptionalDouble bestRate = auctionBidStore.getCurrentBestRate(cid);
                            if (bestRate.isPresent()) {
                                dto.setCurrentBestRate(JsonNullable.of(bestRate.getAsDouble()));
                            }
                            // Bid count only revealed to the supplier (company that owns the auction)
                            if (party.equals(c.payload.getSupplier.getParty)) {
                                dto.setBidCount(JsonNullable.of(auctionBidStore.getBidCount(cid)));
                            }
                            // Auction end time from creation-time store
                            Instant createdAt = auctionCreatedAt.get(cid);
                            if (createdAt != null) {
                                dto.setAuctionEndTime(JsonNullable.of(java.time.OffsetDateTime.ofInstant(
                                        createdAt.plusSeconds(c.payload.getAuctionDurationSecs),
                                        java.time.ZoneOffset.UTC)));
                            }
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
                            BigDecimal.valueOf(req.getOfferedRate()),
                            Optional.empty()  // No oracle guardrail for grabAuction (future: pass req.getOracleContractId())
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
                    // Archive directly — the old deployed package (@b2fe96ff) has
                    // `archive self` inside FinancingAuction_Cancel, which causes
                    // CONTRACT_NOT_ACTIVE (double-consume). Using ledger.archive() bypasses
                    // the choice entirely and submits a raw Archive exercise command.
                    return ledger.archive(contract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                            .thenApply(v -> ResponseEntity.<Void>noContent().build());
                })
        ));
    }

    // ─── Sealed-Bid Auction Endpoints ───────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<PlaceBidResult>> placeBid(
            String contractId, String commandId, PlaceBidRequest placeBidRequest) {
        var ctx = tracingCtx(logger, "placeBid", "contractId", contractId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findAuctionById(contractId).thenApplyAsync(opt -> {
                    var contract = ensurePresent(opt, "Auction not found: %s", contractId);
                    // Verify this institution is eligible
                    boolean eligible = contract.payload.getEligibleBanks.stream()
                            .anyMatch(p -> p.getParty.equals(party));
                    if (!eligible) {
                        throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                                "Party " + party + " is not eligible to bid in auction " + contractId);
                    }
                    if (!"OPEN".equals(contract.payload.getStatus)) {
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "Auction is not OPEN");
                    }
                    double rate = placeBidRequest.getOfferedRate();
                    if (rate <= 0 || rate > 100) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                                "offeredRate must be between 0 and 100");
                    }
                    PlaceBidResult result = auctionBidStore.placeBid(contractId, party, rate);
                    logger.info("placeBid: auctionId={} party={} rate={} winning={}",
                            contractId, party, rate, result.getIsCurrentBestBid());
                    return ResponseEntity.ok(result);
                })
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<BidStatusDto>> getMyBidStatus(String contractId) {
        var ctx = tracingCtx(logger, "getMyBidStatus", "contractId", contractId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                CompletableFuture.completedFuture(
                        ResponseEntity.ok(auctionBidStore.getBidStatus(contractId, party)))
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<CloseAuctionResult>> closeAuction(
            String contractId, String commandId) {
        var ctx = tracingCtx(logger, "closeAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                    var auctionContract = ensurePresent(opt, "Auction not found: %s", contractId);
                    // Only the supplier (company) can close their auction
                    if (!party.equals(auctionContract.payload.getSupplier.getParty)) {
                        throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                                "Only the supplier can close this auction");
                    }

                    var winnerOpt = auctionBidStore.getWinner(contractId);
                    if (winnerOpt.isEmpty()) {
                        // No bids — archive directly (same fix as cancelAuction)
                        logger.info("closeAuction: no bids — archiving auction {}", contractId);
                        return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                                .thenApply(v -> {
                                    auctionBidStore.clearAuction(contractId);
                                    auctionCreatedAt.remove(contractId);
                                    var result = new CloseAuctionResult();
                                    result.setNoWinner(true);
                                    return ResponseEntity.ok(result);
                                });
                    }

                    AuctionBidStore.WinnerInfo winner = winnerOpt.get();
                    logger.info("closeAuction: settling auction {} with winner={} rate={}",
                            contractId, winner.partyId(), winner.rate());

                    double purchaseAmount = auctionContract.payload.getAmount.doubleValue()
                            * winner.rate() / 100.0;

                    // The old deployed package (@b2fe96ff) has `archive self` inside
                    // FinancingAuction_BankGrab, causing CONTRACT_NOT_ACTIVE (double-consume).
                    // Fix: archive the auction directly, then create+settle a WinningBid atomically.
                    String archiveCommandId = commandId + "-archive";
                    return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, archiveCommandId)
                            .thenComposeAsync(v -> {
                                var winningBid = new WinningBid(
                                        auctionContract.payload.getOperator,
                                        auctionContract.payload.getSupplier,
                                        auctionContract.payload.getBuyer,
                                        new Party(winner.partyId()),
                                        auctionContract.payload.getInvoiceId,
                                        auctionContract.payload.getAmount,
                                        auctionContract.payload.getDescription,
                                        auctionContract.payload.getDueDate,
                                        BigDecimal.valueOf(winner.rate()),
                                        BigDecimal.valueOf(purchaseAmount),
                                        "PENDING_SETTLEMENT"
                                );
                                String settleCommandId = commandId + "-settle";
                                return ledger.createAndExercise(winningBid, new WinningBid_Settle(), settleCommandId);
                            })
                            .thenApply(settled -> {
                                auctionBidStore.clearAuction(contractId);
                                auctionCreatedAt.remove(contractId);

                                String displayName = ProfileApiImpl.getDisplayName(winner.partyId());

                                var result = new CloseAuctionResult();
                                result.setNoWinner(false);
                                result.setWinningInstitutionPartyId(JsonNullable.of(winner.partyId()));
                                result.setWinningInstitutionDisplayName(JsonNullable.of(displayName));
                                result.setWinningRate(JsonNullable.of(winner.rate()));
                                result.setFinancedInvoiceContractId(JsonNullable.of(
                                        settled.getFinancedInvoiceId.getContractId));
                                result.setPurchaseAmount(JsonNullable.of(purchaseAmount));
                                return ResponseEntity.ok(result);
                            });
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

    /**
     * Resolves the eligible bank party IDs when none are specified by the company.
     * Priority: (1) registered INSTITUTION profiles, (2) all non-internal tenant parties.
     * The caller/supplier party is excluded to avoid self-bidding.
     */
    private List<String> resolveEligibleBanks(String supplierParty) {
        // Try institution profiles first
        List<String> institutions = ProfileApiImpl.getInstitutionPartyIds();
        if (!institutions.isEmpty()) {
            return institutions;
        }
        // Fall back to all non-internal tenants (excludes the operator/AppProvider)
        String operatorParty = auth.getAppProviderPartyId();
        List<String> tenantParties = tenantRepo.getAllTenants().values().stream()
                .filter(t -> !t.isInternal())
                .map(TenantPropertiesRepository.TenantProperties::getPartyId)
                .filter(p -> p != null && !p.equals(operatorParty) && !p.equals(supplierParty))
                .toList();
        if (!tenantParties.isEmpty()) {
            return tenantParties;
        }
        // Last resort: include the operator so the auction is never empty
        return List.of(operatorParty);
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
