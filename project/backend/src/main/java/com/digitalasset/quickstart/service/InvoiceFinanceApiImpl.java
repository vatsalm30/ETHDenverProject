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
import jakarta.annotation.PostConstruct;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.openapitools.jackson.nullable.JsonNullable;
import org.openapitools.model.UserProfileDto;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.context.SecurityContextHolder;

import org.openapitools.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 *
 * <p>Multi-tenancy model: all users share the AppProvider Daml party (shared-secret / OAuth2 demo),
 * so isolation is enforced at the application layer via username-keyed ownership maps.
 * COMPANY users only see their own invoices and auctions.
 * INSTITUTION users see all open auctions (to place bids).
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
     */
    private final java.util.concurrent.ConcurrentHashMap<String, InvoiceDto> pendingInvoices =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Username that created each pending invoice (pseudoId → username). */
    private final java.util.concurrent.ConcurrentHashMap<String, String> invoiceOwner =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Username that created each active auction (contractId → username). Persisted to DB. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> auctionOwner =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Absolute end time for each active auction (contractId → endTime). Persisted to DB. */
    private final java.util.concurrent.ConcurrentHashMap<String, Instant> auctionEndTimes =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Company username that owns each financed invoice (fiCid → companyUsername). Persisted. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> financedInvoiceCompany =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Winning institution username for each financed invoice (fiCid → winnerUsername). Persisted. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> financedInvoiceWinner =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Winning institution username for each bank ownership (boCid → winnerUsername). Persisted. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> bankOwnershipWinner =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Company username for each paid invoice (paidCid → companyUsername). Persisted. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> paidInvoiceCompany =
            new java.util.concurrent.ConcurrentHashMap<>();

    /** Winning institution username for each paid invoice (paidCid → winnerUsername). Persisted. */
    private final java.util.concurrent.ConcurrentHashMap<String, String> paidInvoiceWinner =
            new java.util.concurrent.ConcurrentHashMap<>();

    private final LedgerApi ledger;
    private final AuthUtils auth;
    private final DamlRepository damlRepository;
    private final TenantPropertiesRepository tenantRepo;
    private final AuctionBidStore auctionBidStore;
    private final EvmSettlementService evmSettlementService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ZkServiceClient zkClient;

    @Autowired
    private SupplierTrustController trustController;

    @Autowired
    private BankTrustController bankTrustController;

    @Autowired
    private BuyerZkServiceClient buyerZkClient;

    @Autowired
    private BuyerTrustController buyerTrustController;

    @Value("${anthropic.api-key:}")
    private String anthropicApiKey;

    @Value("${gemini.api-key:}")
    private String geminiApiKey;

    @Autowired
    public InvoiceFinanceApiImpl(LedgerApi ledger, AuthUtils auth, DamlRepository damlRepository,
                                  TenantPropertiesRepository tenantRepo, AuctionBidStore auctionBidStore,
                                  EvmSettlementService evmSettlementService) {
        this.ledger = ledger;
        this.auth = auth;
        this.damlRepository = damlRepository;
        this.tenantRepo = tenantRepo;
        this.auctionBidStore = auctionBidStore;
        this.evmSettlementService = evmSettlementService;
    }

    /**
     * On startup: create persistence tables if they don't exist and load existing auction data
     * so that countdowns and ownership survive backend restarts.
     */
    @PostConstruct
    public void initAuctionStore() {
        try {
            // ── Supplier trust score persistence ──────────────────────────
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS supplier_trust_scores (" +
                "  username TEXT PRIMARY KEY, " +
                "  tier TEXT NOT NULL DEFAULT 'PROVISIONAL', " +
                "  certified BOOLEAN NOT NULL DEFAULT false, " +
                "  total_score INTEGER NOT NULL DEFAULT 0, " +
                "  max_score INTEGER NOT NULL DEFAULT 7, " +
                "  pending_count INTEGER NOT NULL DEFAULT 3, " +
                "  reason TEXT, " +
                "  invoice_value_cap INTEGER, " +
                "  proof1_status TEXT DEFAULT 'PASS', " +
                "  proof2_status TEXT DEFAULT 'PENDING', " +
                "  proof3_status TEXT DEFAULT 'PENDING', " +
                "  proof4_status TEXT DEFAULT 'PENDING', " +
                "  proof1_points INTEGER DEFAULT 0, " +
                "  proof2_points INTEGER DEFAULT 0, " +
                "  proof3_points INTEGER DEFAULT 0, " +
                "  proof4_points INTEGER DEFAULT 0, " +
                "  on_time_paid INTEGER DEFAULT 0, " +
                "  total_invoices INTEGER DEFAULT 0, " +
                "  invoices_6mo INTEGER DEFAULT 0, " +
                "  total_disputes INTEGER DEFAULT 0, " +
                "  last_calculated BIGINT DEFAULT 0)");

            // ── Bank trust score persistence ─────────────────────────────
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS bank_trust_scores (" +
                "  username TEXT PRIMARY KEY, " +
                "  tier TEXT NOT NULL DEFAULT 'SUSPENDED', " +
                "  certified BOOLEAN NOT NULL DEFAULT false, " +
                "  can_bid BOOLEAN NOT NULL DEFAULT false, " +
                "  total_score INTEGER NOT NULL DEFAULT 0, " +
                "  reason TEXT, " +
                "  proofx_status TEXT DEFAULT 'FAIL', " +
                "  proofy_status TEXT DEFAULT 'PENDING', " +
                "  proofz_status TEXT DEFAULT 'FAIL', " +
                "  proofx_points INTEGER DEFAULT 0, " +
                "  proofy_points INTEGER DEFAULT 0, " +
                "  proofz_points INTEGER DEFAULT 0, " +
                "  reserve_balance DOUBLE PRECISION DEFAULT 1000000, " +
                "  financing_amount DOUBLE PRECISION DEFAULT 100000, " +
                "  registration_ts BIGINT, " +
                "  last_offered_rate INTEGER DEFAULT 0, " +
                "  last_calculated BIGINT DEFAULT 0)");

            // ── Buyer trust score persistence ──────────────────────────
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS buyer_trust_scores (" +
                "  buyer_id TEXT PRIMARY KEY, " +
                "  tier TEXT NOT NULL DEFAULT 'PROVISIONAL', " +
                "  certified BOOLEAN NOT NULL DEFAULT false, " +
                "  total_score INTEGER NOT NULL DEFAULT 0, " +
                "  max_score INTEGER NOT NULL DEFAULT 10, " +
                "  pending_count INTEGER NOT NULL DEFAULT 4, " +
                "  reason TEXT, " +
                "  proof1_status TEXT DEFAULT 'PENDING', " +
                "  proof2_status TEXT DEFAULT 'PENDING', " +
                "  proof3_status TEXT DEFAULT 'PENDING', " +
                "  proof4_status TEXT DEFAULT 'PENDING', " +
                "  proof1_points INTEGER DEFAULT 0, " +
                "  proof2_points INTEGER DEFAULT 0, " +
                "  proof3_points INTEGER DEFAULT 0, " +
                "  proof4_points INTEGER DEFAULT 0, " +
                "  total_invoices_paid INTEGER DEFAULT 0, " +
                "  total_invoices_obligation INTEGER DEFAULT 0, " +
                "  confirmed_count INTEGER DEFAULT 0, " +
                "  total_received INTEGER DEFAULT 0, " +
                "  total_disputes INTEGER DEFAULT 0, " +
                "  on_time_payments INTEGER DEFAULT 0, " +
                "  total_payments INTEGER DEFAULT 0, " +
                "  last_calculated BIGINT DEFAULT 0)");
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS buyer_invoices (" +
                "  id SERIAL PRIMARY KEY, " +
                "  buyer_id TEXT NOT NULL, " +
                "  invoice_id TEXT NOT NULL, " +
                "  status TEXT NOT NULL DEFAULT 'PENDING', " +
                "  confirmed_on_time BOOLEAN DEFAULT true, " +
                "  paid_on_time BOOLEAN DEFAULT false, " +
                "  disputes INTEGER DEFAULT 0, " +
                "  created_epoch BIGINT DEFAULT 0, " +
                "  paid_epoch BIGINT DEFAULT 0)");
            jdbcTemplate.execute(
                "CREATE INDEX IF NOT EXISTS idx_buyer_invoices_buyer_id ON buyer_invoices(buyer_id)");

            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS auction_end_times (" +
                "  contract_id TEXT PRIMARY KEY, end_epoch_sec BIGINT NOT NULL)");
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS auction_owners (" +
                "  contract_id TEXT PRIMARY KEY, username TEXT NOT NULL)");
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS fi_owners (" +
                "  contract_id TEXT PRIMARY KEY, company_username TEXT, winner_username TEXT)");
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS bo_winners (" +
                "  contract_id TEXT PRIMARY KEY, winner_username TEXT NOT NULL)");
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS paid_owners (" +
                "  contract_id TEXT PRIMARY KEY, company_username TEXT, winner_username TEXT)");

            // Load into memory
            jdbcTemplate.query("SELECT contract_id, end_epoch_sec FROM auction_end_times", rs -> {
                auctionEndTimes.put(rs.getString("contract_id"),
                        Instant.ofEpochSecond(rs.getLong("end_epoch_sec")));
            });
            jdbcTemplate.query("SELECT contract_id, username FROM auction_owners", rs -> {
                auctionOwner.put(rs.getString("contract_id"), rs.getString("username"));
            });
            jdbcTemplate.query("SELECT contract_id, company_username, winner_username FROM fi_owners", rs -> {
                String cid = rs.getString("contract_id");
                if (rs.getString("company_username") != null) financedInvoiceCompany.put(cid, rs.getString("company_username"));
                if (rs.getString("winner_username") != null) financedInvoiceWinner.put(cid, rs.getString("winner_username"));
            });
            jdbcTemplate.query("SELECT contract_id, winner_username FROM bo_winners", rs -> {
                bankOwnershipWinner.put(rs.getString("contract_id"), rs.getString("winner_username"));
            });
            jdbcTemplate.query("SELECT contract_id, company_username, winner_username FROM paid_owners", rs -> {
                String cid = rs.getString("contract_id");
                if (rs.getString("company_username") != null) paidInvoiceCompany.put(cid, rs.getString("company_username"));
                if (rs.getString("winner_username") != null) paidInvoiceWinner.put(cid, rs.getString("winner_username"));
            });
            logger.info("initAuctionStore: loaded {} end times, {} auction owners, {} FI owners, {} BO winners, {} paid owners",
                    auctionEndTimes.size(), auctionOwner.size(),
                    financedInvoiceCompany.size(), bankOwnershipWinner.size(), paidInvoiceCompany.size());
        } catch (Exception e) {
            logger.warn("initAuctionStore: failed to initialize persistence tables — {}", e.getMessage());
        }
    }

    /** Returns the username of the currently authenticated user. */
    private static String currentUsername() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return (authentication != null) ? authentication.getName() : null;
    }

    // ─── AI Invoice Parse ────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<ParsedInvoiceDto>> parseInvoice(
            org.openapitools.model.ParseInvoiceRequest req) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                // Prefer Gemini; fall back to Anthropic (legacy); fall back to mock
                if (geminiApiKey != null && !geminiApiKey.isBlank()) {
                    return ResponseEntity.ok(parseWithGemini(req));
                }
                if (anthropicApiKey != null && !anthropicApiKey.isBlank()) {
                    return ResponseEntity.ok(parseWithAnthropic(req));
                }
                return ResponseEntity.ok(mockParsedInvoice());
            } catch (Exception e) {
                logger.error("Invoice parse failed", e);
                return ResponseEntity.ok(mockParsedInvoice());
            }
        });
    }

    private ParsedInvoiceDto parseWithGemini(org.openapitools.model.ParseInvoiceRequest req) throws Exception {
        String prompt = "Extract invoice data from this image. Return ONLY valid JSON with these exact fields: " +
                "{\"invoiceNumber\":\"string\",\"vendorName\":\"string\",\"buyerName\":\"string\"," +
                "\"amount\":number,\"issueDate\":\"YYYY-MM-DD\",\"dueDate\":\"YYYY-MM-DD\"," +
                "\"description\":\"string\",\"confidence\":number_0_to_1}. " +
                "Use null for any field not visible. No text outside the JSON.";

        var part1 = Map.of("text", prompt);
        var inlineData = Map.of("mime_type", req.getMimeType(), "data", req.getFileBase64());
        var part2 = Map.of("inline_data", inlineData);
        var content = Map.of("parts", List.of(part1, part2));
        var body = Map.of("contents", List.of(content));

        String requestBody = objectMapper.writeValueAsString(body);
        String url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiApiKey;

        HttpRequest httpReq = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();

        HttpResponse<String> httpResp = httpClient.send(httpReq, HttpResponse.BodyHandlers.ofString());
        JsonNode root = objectMapper.readTree(httpResp.body());
        String text = root.path("candidates").get(0).path("content").path("parts").get(0).path("text").asText();
        text = text.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        return parsedInvoiceDtoFromJson(objectMapper.readTree(text));
    }

    private ParsedInvoiceDto parseWithAnthropic(org.openapitools.model.ParseInvoiceRequest req) throws Exception {
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
        text = text.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        return parsedInvoiceDtoFromJson(objectMapper.readTree(text));
    }

    private ParsedInvoiceDto parsedInvoiceDtoFromJson(JsonNode parsed) {
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
        return dto;
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
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "listInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Each user only sees their own pending invoices (username-keyed isolation)
            var list = pendingInvoices.values().stream()
                    .filter(dto -> username != null && username.equals(invoiceOwner.get(dto.getContractId())))
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
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "createInvoice", "commandId", commandId, "invoiceId", req.getInvoiceId());
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
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
            // Record who created this invoice for multi-tenant isolation
            if (username != null) invoiceOwner.put(pseudoId, username);
            logger.info("createInvoice stored in-memory: pseudoId={} invoiceId={} owner={}", pseudoId, req.getInvoiceId(), username);
            // Increment 6-month invoice counter for trust scoring
            if (username != null) incrementInvoices6mo(username);
            return CompletableFuture.completedFuture(
                    ResponseEntity.status(HttpStatus.CREATED).body(dto));
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<Void>> deleteInvoice(String contractId, String commandId) {
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "deleteInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            String owner = invoiceOwner.get(contractId);
            if (owner != null && !owner.equals(username)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not own this invoice");
            }
            boolean removed = pendingInvoices.remove(contractId) != null;
            if (removed) invoiceOwner.remove(contractId);
            logger.info("deleteInvoice: contractId={} removed={}", contractId, removed);
            return CompletableFuture.completedFuture(ResponseEntity.<Void>noContent().build());
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<InvoiceDto>> confirmInvoice(String contractId, String commandId) {
        var ctx = tracingCtx(logger, "confirmInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            var dto = pendingInvoices.get(contractId);
            if (dto == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invoice not found: " + contractId);
            }

            // ── Buyer ZK trust score (non-blocking — buyer is NEVER blocked) ─────
            // Record this invoice in the buyer's obligation history and trigger
            // an async ZK score refresh. The response returns immediately regardless.
            String buyerId = dto.getBuyer() != null ? dto.getBuyer() : "unknown-buyer";
            recordBuyerInvoiceReceived(buyerId, dto.getInvoiceId());
            buyerTrustController.triggerScoreRefresh(buyerId);

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
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "startAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            var invoiceDto = pendingInvoices.get(contractId);
            if (invoiceDto == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Invoice not found: " + contractId + ". It may have already been auctioned or deleted.");
            }

            // Ownership check — only the company that created this invoice can auction it
            String owner = invoiceOwner.get(contractId);
            if (owner != null && !owner.equals(username)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not own this invoice");
            }

            // Resolve auction duration: days take precedence over seconds
            long auctionDurationSecs;
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

            // ── ZK Trust Score enforcement ──────────────────────────────────
            // Pull supplier's historical stats from DB (0-values for new suppliers).
            int[] stats = trustController.getStats(username != null ? username : "unknown");
            String invoiceHash = String.valueOf(Math.abs(invoiceDto.getInvoiceId().hashCode()) + 100_000L);

            Instant createdAt = Instant.now();
            return zkClient.getSupplierTrustScore(
                    username != null ? username : party,
                    invoiceHash,
                    stats[0], // onTimePaidCount
                    stats[1], // totalInvoiceCount
                    stats[2], // invoiceCountLast6Months
                    stats[3], // totalDisputes
                    "1234567890" // canonical registryRoot
            ).thenComposeAsync(trustScore -> {
                // Persist the fresh score so the dashboard reflects it immediately
                trustController.persistScore(username != null ? username : party, trustScore, stats);

                // UNRATED → blocked entirely
                if ("UNRATED".equals(trustScore.tier)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                            "Supplier trust score too low to create auction");
                }
                // PROVISIONAL → allowed but capped at $5,000
                if ("PROVISIONAL".equals(trustScore.tier) && invoiceDto.getAmount() > 5000) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "Provisional suppliers are limited to $5,000 per invoice");
                }

                return withLedgerRetry(() -> ledger.createAndGetId(auction, commandId), 5, 3000L)
                    .thenApply(auctionCid -> {
                        String auctionCidStr = auctionCid.getContractId;
                        // Remove from pending map
                        pendingInvoices.remove(contractId);
                        invoiceOwner.remove(contractId);

                        // Compute and persist end time
                        Instant endTime = createdAt.plusSeconds(finalDurationSecs);
                        auctionEndTimes.put(auctionCidStr, endTime);
                        persistAuctionEndTime(auctionCidStr, endTime);

                        // Record and persist auction owner
                        if (username != null) {
                            auctionOwner.put(auctionCidStr, username);
                            persistAuctionOwner(auctionCidStr, username);
                        }

                        var dto = new FinancingAuctionDto();
                        dto.setContractId(auctionCidStr);
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
                                endTime, java.time.ZoneOffset.UTC)));

                        // ── Trust score fields on the auction DTO ───────────
                        dto.setSupplierTier(JsonNullable.of(trustScore.tier));
                        dto.setSupplierCertified(JsonNullable.of(trustScore.certified));
                        dto.setSupplierTrustScore(JsonNullable.of(trustScore.totalScore));
                        dto.setSupplierMaxScore(JsonNullable.of(trustScore.maxPossibleScore));
                        dto.setSupplierPendingCount(JsonNullable.of(trustScore.pendingCount));
                        dto.setSupplierReason(JsonNullable.of(trustScore.reason));
                        dto.setInvoiceValueCap(JsonNullable.of(trustScore.invoiceValueCap));
                        dto.setProof1Status(JsonNullable.of(trustScore.proof1Status));
                        dto.setProof2Status(JsonNullable.of(trustScore.proof2Status));
                        dto.setProof3Status(JsonNullable.of(trustScore.proof3Status));
                        dto.setProof4Status(JsonNullable.of(trustScore.proof4Status));

                        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
                    });
            }); // end zkClient.thenComposeAsync
        }));
    }

    // ─── Auctions ───────────────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<FinancingAuctionDto>>> listAuctions() {
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        UserProfileDto.TypeEnum profileType = ProfileApiImpl.getProfileType(username);
        boolean isCompany = UserProfileDto.TypeEnum.COMPANY.equals(profileType);
        var ctx = tracingCtx(logger, "listAuctions");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveAuctions(party).thenApplyAsync(contracts -> {

                    return ResponseEntity.ok(contracts.stream()
                            .filter(c -> {
                                String cid = c.contractId.getContractId;
                                if (isCompany) {
                                    // Companies only see auctions they created
                                    String owner = auctionOwner.get(cid);
                                    return username != null && username.equals(owner);
                                }
                                // Institutions see all open auctions
                                return "OPEN".equals(c.payload.getStatus);
                            })
                            .map(c -> {
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

                                // Sealed-bid data
                                OptionalDouble bestRate = auctionBidStore.getCurrentBestRate(cid);
                                if (bestRate.isPresent()) {
                                    dto.setCurrentBestRate(JsonNullable.of(bestRate.getAsDouble()));
                                }
                                // Bid count only revealed to the company that owns the auction
                                if (isCompany && username != null && username.equals(auctionOwner.get(cid))) {
                                    dto.setBidCount(JsonNullable.of(auctionBidStore.getBidCount(cid)));
                                }
                                // Average bid — market calibration signal for institutions
                                OptionalDouble avgBid = auctionBidStore.getAverageBid(cid);
                                if (avgBid.isPresent()) {
                                    dto.setAverageBid(JsonNullable.of(avgBid.getAsDouble()));
                                }
                                // Auction end time from persistent store (survives restarts)
                                Instant endTime = auctionEndTimes.get(cid);
                                if (endTime != null) {
                                    dto.setAuctionEndTime(JsonNullable.of(java.time.OffsetDateTime.ofInstant(
                                            endTime, java.time.ZoneOffset.UTC)));
                                }
                                // Attach cached supplier ZK trust tier for bank-side display
                                String ownerName = auctionOwner.get(cid);
                                if (ownerName != null) {
                                    try {
                                        var trustRows = jdbcTemplate.queryForList(
                                            "SELECT tier, certified FROM supplier_trust_scores WHERE username = ?",
                                            ownerName);
                                        if (!trustRows.isEmpty()) {
                                            var tr = trustRows.get(0);
                                            dto.setSupplierTier(JsonNullable.of(
                                                tr.getOrDefault("tier", "PROVISIONAL").toString()));
                                            dto.setSupplierCertified(JsonNullable.of(
                                                Boolean.TRUE.equals(tr.get("certified"))));
                                        } else {
                                            dto.setSupplierTier(JsonNullable.of("PROVISIONAL"));
                                            dto.setSupplierCertified(JsonNullable.of(false));
                                        }
                                    } catch (Exception e) {
                                        logger.warn("listAuctions: supplier trust lookup failed for {}: {}", ownerName, e.getMessage());
                                    }
                                }

                                // Attach cached buyer ZK trust data
                                String buyerPartyId = c.payload.getBuyer.getParty;
                                String resolvedSupplierTier = dto.getSupplierTier().isPresent()
                                        ? dto.getSupplierTier().get() : "PROVISIONAL";
                                try {
                                    var buyerRows = jdbcTemplate.queryForList(
                                        "SELECT tier, certified, total_score, max_score, pending_count, reason, " +
                                        "proof1_status, proof2_status, proof3_status, proof4_status " +
                                        "FROM buyer_trust_scores WHERE buyer_id = ?",
                                        buyerPartyId);
                                    if (!buyerRows.isEmpty()) {
                                        var br = buyerRows.get(0);
                                        String bTier = br.getOrDefault("tier", "PROVISIONAL").toString();
                                        dto.setBuyerTier(JsonNullable.of(bTier));
                                        dto.setBuyerCertified(JsonNullable.of(Boolean.TRUE.equals(br.get("certified"))));
                                        dto.setBuyerTrustScore(JsonNullable.of(toIntVal(br.get("total_score"))));
                                        dto.setBuyerMaxScore(JsonNullable.of(toIntVal(br.get("max_score"))));
                                        dto.setBuyerPendingCount(JsonNullable.of(toIntVal(br.get("pending_count"))));
                                        dto.setBuyerReason(JsonNullable.of(br.getOrDefault("reason", "").toString()));
                                        dto.setBuyerProof1Status(JsonNullable.of(br.getOrDefault("proof1_status", "PENDING").toString()));
                                        dto.setBuyerProof2Status(JsonNullable.of(br.getOrDefault("proof2_status", "PENDING").toString()));
                                        dto.setBuyerProof3Status(JsonNullable.of(br.getOrDefault("proof3_status", "PENDING").toString()));
                                        dto.setBuyerProof4Status(JsonNullable.of(br.getOrDefault("proof4_status", "PENDING").toString()));
                                        dto.setHighRiskBuyer(JsonNullable.of("UNRATED".equals(bTier)));
                                        dto.setCombinedRisk(JsonNullable.of(computeCombinedRisk(resolvedSupplierTier, bTier)));
                                    } else {
                                        dto.setBuyerTier(JsonNullable.of("PROVISIONAL"));
                                        dto.setBuyerCertified(JsonNullable.of(false));
                                        dto.setBuyerPendingCount(JsonNullable.of(4));
                                        dto.setHighRiskBuyer(JsonNullable.of(false));
                                        dto.setCombinedRisk(JsonNullable.of(computeCombinedRisk(resolvedSupplierTier, "PROVISIONAL")));
                                    }
                                } catch (Exception e) {
                                    logger.warn("listAuctions: buyer trust lookup failed for {}: {}", buyerPartyId, e.getMessage());
                                }

                                return dto;
                            }).toList());
                })
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
                    return ledger.exerciseAndGetResult(auctionContract.contractId, grabChoice, commandId)
                            .thenComposeAsync(winningBidCid -> {
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
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "cancelAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Ownership check
            String owner = auctionOwner.get(contractId);
            if (owner != null && !owner.equals(username)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not own this auction");
            }
            return damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                var contract = ensurePresent(opt, "Auction not found: %s", contractId);
                return ledger.archive(contract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                        .thenApply(v -> {
                            cleanupAuction(contractId);
                            return ResponseEntity.<Void>noContent().build();
                        });
            });
        }));
    }

    // ─── Sealed-Bid Auction Endpoints ───────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<PlaceBidResult>> placeBid(
            String contractId, String commandId, PlaceBidRequest placeBidRequest) {
        String username = currentUsername();
        var ctx = tracingCtx(logger, "placeBid", "contractId", contractId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "Auction not found: %s", contractId);
                    if (!"OPEN".equals(contract.payload.getStatus)) {
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "Auction is not OPEN");
                    }
                    double rate = placeBidRequest.getOfferedRate();
                    if (rate <= 0 || rate > 100) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                                "offeredRate must be between 0 and 100");
                    }
                    String bidKey = username != null ? username : party;
                    double financingAmount = contract.payload.getAmount.doubleValue() * rate / 100.0;

                    int rateBasisPoints = (int) Math.round(rate * 100);
                    return bankTrustController.verifyBankForBid(bidKey, financingAmount, rateBasisPoints)
                            .thenApply(bankScore -> {
                                if (!bankScore.canBid) {
                                    logger.warn("placeBid BLOCKED: bank={} tier={} reason={}",
                                            bidKey, bankScore.tier, bankScore.reason);
                                    throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                                            bankScore.reason != null ? bankScore.reason
                                                    : "Bank is not certified to bid");
                                }
                                PlaceBidResult result = auctionBidStore.placeBid(contractId, bidKey, rate);
                                logger.info("placeBid: auctionId={} user={} rate={} winning={} bankTier={}",
                                        contractId, bidKey, rate, result.getIsCurrentBestBid(), bankScore.tier);
                                return ResponseEntity.ok(result);
                            });
                })
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<BidStatusDto>> getMyBidStatus(String contractId) {
        // Use username as the bid key so each institution user sees only their own bid
        String username = currentUsername();
        var ctx = tracingCtx(logger, "getMyBidStatus", "contractId", contractId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            String bidKey = username != null ? username : party;
            BidStatusDto statusDto = auctionBidStore.getBidStatus(contractId, bidKey);
            OptionalDouble avg = auctionBidStore.getAverageBid(contractId);
            if (avg.isPresent()) statusDto.setAverageBid(JsonNullable.of(avg.getAsDouble()));
            return CompletableFuture.completedFuture(ResponseEntity.ok(statusDto));
        }));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<CloseAuctionResult>> closeAuction(
            String contractId, String commandId) {
        // Capture on HTTP thread — SecurityContextHolder is ThreadLocal and won't propagate into async pool
        String username = currentUsername();
        var ctx = tracingCtx(logger, "closeAuction", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () -> {
            // Ownership check — username-based since all users share the same Daml party
            String owner = auctionOwner.get(contractId);
            if (owner != null && !owner.equals(username)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Only the supplier can close this auction");
            }
            return damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
                var auctionContract = ensurePresent(opt, "Auction not found: %s", contractId);

                var winnerOpt = auctionBidStore.getWinner(contractId);
                if (winnerOpt.isEmpty()) {
                    logger.info("closeAuction: no bids — archiving auction {}", contractId);
                    return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                            .thenApply(v -> {
                                cleanupAuction(contractId);
                                var result = new CloseAuctionResult();
                                result.setNoWinner(true);
                                return ResponseEntity.ok(result);
                            });
                }

                // Double-verify winning bank certification before settlement.
                // Walk the bid list until we find a certified bank.
                AuctionBidStore.WinnerInfo winner = winnerOpt.get();
                double auctionAmount = auctionContract.payload.getAmount.doubleValue();
                try {
                    double financingAmt = auctionAmount * winner.rate() / 100.0;
                    int winnerRateBps = (int) Math.round(winner.rate() * 100);
                    var bankScore = bankTrustController.verifyBankForBid(winner.username(), financingAmt, winnerRateBps).join();
                    if (!bankScore.canBid) {
                        logger.warn("closeAuction: winning bank {} no longer certified (tier={}), selecting next bidder",
                                winner.username(), bankScore.tier);
                        var nextWinner = auctionBidStore.getNextCertifiedWinner(contractId, winner.username());
                        if (nextWinner.isEmpty()) {
                            logger.info("closeAuction: no certified bidders remain — archiving auction {}", contractId);
                            return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                                    .thenApply(v -> {
                                        cleanupAuction(contractId);
                                        var result = new CloseAuctionResult();
                                        result.setNoWinner(true);
                                        return ResponseEntity.ok(result);
                                    });
                        }
                        winner = nextWinner.get();
                    }
                } catch (Exception e) {
                    logger.warn("closeAuction: bank re-verification failed for {} — proceeding with caution: {}",
                            winner.username(), e.getMessage());
                }

                logger.info("closeAuction: settling auction {} with winner={} rate={}",
                        contractId, winner.username(), winner.rate());

                double purchaseAmount = auctionAmount * winner.rate() / 100.0;

                String archiveCommandId = commandId + "-archive";
                AuctionBidStore.WinnerInfo finalWinner = winner;
                return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, archiveCommandId)
                        .thenComposeAsync(v -> {
                            // WinningBid_Settle has archive-self bug in deployed @b2fe96ff —
                            // bypass it entirely: create FinancedInvoice + BankOwnership directly.
                            // FinancedInvoice requires signatory operator+supplier+buyer+bank;
                            // in this demo all users share one party so we use operator for all four.
                            var op = auctionContract.payload.getOperator;
                            var financedInvoice = new FinancedInvoice(
                                    op, op, op, op,
                                    auctionContract.payload.getInvoiceId,
                                    auctionContract.payload.getAmount,
                                    auctionContract.payload.getDescription,
                                    auctionContract.payload.getDueDate,
                                    "ACTIVE",
                                    false,
                                    BigDecimal.ZERO
                            );
                            var bankOwnership = new BankOwnership(
                                    op, op,
                                    auctionContract.payload.getInvoiceId,
                                    BigDecimal.valueOf(finalWinner.rate()),
                                    BigDecimal.valueOf(purchaseAmount),
                                    auctionContract.payload.getAmount
                            );
                            String fiCommandId = commandId + "-fi";
                            String boCommandId = commandId + "-bo";
                            return ledger.createAndGetId(financedInvoice, fiCommandId)
                                    .thenComposeAsync(fiCid ->
                                            ledger.createAndGetId(bankOwnership, boCommandId)
                                                    .thenApply(boCid -> new String[]{
                                                            fiCid.getContractId, boCid.getContractId}));
                        })
                        .thenApply(cids -> {
                            String fiCidStr = cids[0];
                            String boCidStr = cids[1];
                            cleanupAuction(contractId);

                            financedInvoiceCompany.put(fiCidStr, username);
                            financedInvoiceWinner.put(fiCidStr, finalWinner.username());
                            bankOwnershipWinner.put(boCidStr, finalWinner.username());
                            persistFiOwner(fiCidStr, username, finalWinner.username());
                            persistBoWinner(boCidStr, finalWinner.username());

                            String displayName = ProfileApiImpl.getDisplayNameByUsername(finalWinner.username());

                            var result = new CloseAuctionResult();
                            result.setNoWinner(false);
                            result.setWinningInstitutionPartyId(JsonNullable.of(finalWinner.username()));
                            result.setWinningInstitutionDisplayName(JsonNullable.of(displayName));
                            result.setWinningRate(JsonNullable.of(finalWinner.rate()));
                            result.setFinancedInvoiceContractId(JsonNullable.of(fiCidStr));
                            result.setPurchaseAmount(JsonNullable.of(purchaseAmount));
                            return ResponseEntity.ok(result);
                        });
            });
        }));
    }

    // ─── Financed Invoices ──────────────────────────────────────────────────

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<FinancedInvoiceDto>>> listFinancedInvoices() {
        String username = currentUsername();
        UserProfileDto.TypeEnum profileType = ProfileApiImpl.getProfileType(username);
        boolean isCompany = UserProfileDto.TypeEnum.COMPANY.equals(profileType);
        var ctx = tracingCtx(logger, "listFinancedInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveFinancedInvoices(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream()
                                .filter(c -> {
                                    String cid = c.contractId.getContractId;
                                    if (isCompany) return username.equals(financedInvoiceCompany.get(cid));
                                    else return username != null && username.equals(financedInvoiceWinner.get(cid));
                                })
                                .map(this::toFinancedInvoiceDto)
                                .toList())
                )
        ));
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<PaidInvoiceDto>> payFinancedInvoice(
            String contractId, String commandId) {
        String username = currentUsername();
        var ctx = tracingCtx(logger, "payFinancedInvoice", "contractId", contractId, "commandId", commandId);
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findFinancedInvoiceById(contractId).thenComposeAsync(opt -> {
                    var contract = ensurePresent(opt, "FinancedInvoice not found: %s", contractId);
                    // FinancedInvoice_Pay has archive-self bug in deployed @b2fe96ff —
                    // bypass: archive FinancedInvoice + create PaidInvoice directly.
                    // PaidInvoice requires signatory operator+supplier+buyer+bank;
                    // use operator for all four since demo shares one Canton party.
                    String archiveCommandId = commandId + "-archive";
                    return ledger.archive(contract.contractId, FinancedInvoice.TEMPLATE_ID, archiveCommandId)
                            .thenComposeAsync(v -> {
                                var op = contract.payload.getOperator;
                                var paidInvoice = new PaidInvoice(
                                        op, op, op, op,
                                        contract.payload.getInvoiceId,
                                        contract.payload.getAmount,
                                        contract.payload.getDescription,
                                        contract.payload.isSprintBoostActive,
                                        contract.payload.isSprintBoostActive
                                                ? contract.payload.getSprintBoostBounty
                                                : BigDecimal.ZERO
                                );
                                return ledger.createAndGetId(paidInvoice, commandId + "-paid");
                            })
                            .thenApply(paidCid -> {
                                // Migrate ownership from FinancedInvoice → PaidInvoice
                                String compOwner = financedInvoiceCompany.remove(contractId);
                                String winOwner = financedInvoiceWinner.remove(contractId);
                                if (compOwner != null) paidInvoiceCompany.put(paidCid.getContractId, compOwner);
                                if (winOwner != null) paidInvoiceWinner.put(paidCid.getContractId, winOwner);
                                persistPaidOwner(paidCid.getContractId, compOwner, winOwner);
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
                                // Increment on-time paid count for supplier trust scoring
                                if (username != null) incrementPaidCount(username);
                                // Update buyer invoice stats and recalculate buyer ZK score
                                String buyerParty = contract.payload.getBuyer.getParty;
                                recordBuyerPaymentMade(buyerParty, contract.payload.getInvoiceId, true);
                                buyerTrustController.triggerScoreRefresh(buyerParty);
                                // Canton-first: EVM fires after successful Canton commit
                                evmSettlementService.triggerSettlement(contract.payload.getInvoiceId);
                                evmSettlementService.getSettlement(contract.payload.getInvoiceId).ifPresent(s -> {
                                    dto.setPaymentTxHash(JsonNullable.of(s.txHash()));
                                    dto.setBridgeState(JsonNullable.of(PaidInvoiceDto.BridgeStateEnum.fromValue(s.bridgeState())));
                                });
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
                    // FinancedInvoice_ActivateSprintBoost may have archive-self bug in @b2fe96ff —
                    // bypass: archive old FinancedInvoice + create new one with sprint boost active.
                    String archiveCommandId = commandId + "-archive";
                    return ledger.archive(contract.contractId, FinancedInvoice.TEMPLATE_ID, archiveCommandId)
                            .thenComposeAsync(v -> {
                                var op = contract.payload.getOperator;
                                var updated = new FinancedInvoice(
                                        op, op, op, op,
                                        contract.payload.getInvoiceId,
                                        contract.payload.getAmount,
                                        contract.payload.getDescription,
                                        contract.payload.getDueDate,
                                        "SPRINT_BOOST_ACTIVE",
                                        true,
                                        BigDecimal.valueOf(req.getBountyAmount())
                                );
                                return ledger.createAndGetId(updated, commandId + "-new");
                            })
                            .thenApply(newCid -> {
                                // Migrate FI ownership maps from old contract ID to new one
                                String compOwner = financedInvoiceCompany.remove(contractId);
                                String winOwner = financedInvoiceWinner.remove(contractId);
                                if (compOwner != null) financedInvoiceCompany.put(newCid.getContractId, compOwner);
                                if (winOwner != null) financedInvoiceWinner.put(newCid.getContractId, winOwner);
                                if (compOwner != null || winOwner != null)
                                    persistFiOwner(newCid.getContractId, compOwner, winOwner);
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
        String username = currentUsername();
        var ctx = tracingCtx(logger, "listBankOwnerships");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findActiveBankOwnerships(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream()
                                .filter(c -> username != null && username.equals(
                                        bankOwnershipWinner.get(c.contractId.getContractId)))
                                .map(c -> {
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
        String username = currentUsername();
        UserProfileDto.TypeEnum profileType = ProfileApiImpl.getProfileType(username);
        boolean isCompany = UserProfileDto.TypeEnum.COMPANY.equals(profileType);
        var ctx = tracingCtx(logger, "listPaidInvoices");
        return auth.asAuthenticatedParty(party -> traceServiceCallAsync(ctx, () ->
                damlRepository.findPaidInvoices(party).thenApplyAsync(contracts ->
                        ResponseEntity.ok(contracts.stream()
                                .filter(c -> {
                                    String cid = c.contractId.getContractId;
                                    if (isCompany) return username.equals(paidInvoiceCompany.get(cid));
                                    else return username != null && username.equals(paidInvoiceWinner.get(cid));
                                })
                                .map(c -> {
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
                                    evmSettlementService.getSettlement(c.payload.getInvoiceId).ifPresent(s -> {
                                        dto.setPaymentTxHash(JsonNullable.of(s.txHash()));
                                        dto.setBridgeState(JsonNullable.of(PaidInvoiceDto.BridgeStateEnum.fromValue(s.bridgeState())));
                                    });
                                    return dto;
                                }).toList())
                )
        ));
    }

    // ─── Scheduled Auto-Close ─────────────────────────────────────────────────

    /**
     * Every 60 seconds: auto-close any auction whose end time has passed.
     * Handles early-close (company triggers before end date) OR natural expiry.
     */
    @Scheduled(fixedDelay = 60000)
    public void checkExpiredAuctions() {
        Instant now = Instant.now();
        List<String> expired = new ArrayList<>();
        auctionEndTimes.forEach((cid, endTime) -> {
            if (now.isAfter(endTime)) expired.add(cid);
        });
        for (String contractId : expired) {
            // Remove eagerly so subsequent scheduler ticks won't pick it up again
            if (auctionEndTimes.remove(contractId) != null) {
                logger.info("checkExpiredAuctions: auto-closing expired auction {}", contractId);
                autoCloseAuction(contractId);
            }
        }
    }

    /** Settles (or archives) a single auction without an HTTP request context. */
    private void autoCloseAuction(String contractId) {
        String commandId = "auto-close-" + contractId.substring(0, Math.min(8, contractId.length()))
                + "-" + System.currentTimeMillis();

        damlRepository.findAuctionById(contractId).thenComposeAsync(opt -> {
            if (opt.isEmpty()) {
                logger.warn("autoCloseAuction: auction {} not found on ledger, cleaning up", contractId);
                cleanupAuction(contractId);
                return CompletableFuture.completedFuture(null);
            }

            var auctionContract = opt.get();
            var winnerOpt = auctionBidStore.getWinner(contractId);

            if (winnerOpt.isEmpty()) {
                logger.info("autoCloseAuction: no bids for {}, archiving", contractId);
                return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, commandId)
                        .thenApply(v -> {
                            cleanupAuction(contractId);
                            logger.info("autoCloseAuction: archived (no winner) {}", contractId);
                            return (Void) null;
                        });
            }

            AuctionBidStore.WinnerInfo winner = winnerOpt.get();
            String companyUsername = auctionOwner.get(contractId);
            logger.info("autoCloseAuction: settling {} with winner={} rate={}",
                    contractId, winner.username(), winner.rate());
            double purchaseAmount = auctionContract.payload.getAmount.doubleValue() * winner.rate() / 100.0;

            String archiveCommandId = commandId + "-archive";
            return ledger.archive(auctionContract.contractId, FinancingAuction.TEMPLATE_ID, archiveCommandId)
                    .thenComposeAsync(v -> {
                        // WinningBid_Settle has archive-self bug in deployed @b2fe96ff —
                        // bypass it entirely: create FinancedInvoice + BankOwnership directly.
                        // FinancedInvoice requires signatory operator+supplier+buyer+bank;
                        // in this demo all users share one party so we use operator for all four.
                        var op = auctionContract.payload.getOperator;
                        var financedInvoice = new FinancedInvoice(
                                op, op, op, op,
                                auctionContract.payload.getInvoiceId,
                                auctionContract.payload.getAmount,
                                auctionContract.payload.getDescription,
                                auctionContract.payload.getDueDate,
                                "ACTIVE",
                                false,
                                BigDecimal.ZERO
                        );
                        var bankOwnership = new BankOwnership(
                                op, op,
                                auctionContract.payload.getInvoiceId,
                                BigDecimal.valueOf(winner.rate()),
                                BigDecimal.valueOf(purchaseAmount),
                                auctionContract.payload.getAmount
                        );
                        String fiCommandId = commandId + "-fi";
                        String boCommandId = commandId + "-bo";
                        return ledger.createAndGetId(financedInvoice, fiCommandId)
                                .thenComposeAsync(fiCid ->
                                        ledger.createAndGetId(bankOwnership, boCommandId)
                                                .thenApply(boCid -> new String[]{
                                                        fiCid.getContractId, boCid.getContractId}));
                    })
                    .thenApply(cids -> {
                        String fiCidStr = cids[0];
                        String boCidStr = cids[1];
                        cleanupAuction(contractId);
                        // Store ownership for per-user filtering
                        if (companyUsername != null) financedInvoiceCompany.put(fiCidStr, companyUsername);
                        financedInvoiceWinner.put(fiCidStr, winner.username());
                        bankOwnershipWinner.put(boCidStr, winner.username());
                        persistFiOwner(fiCidStr, companyUsername, winner.username());
                        persistBoWinner(boCidStr, winner.username());
                        logger.info("autoCloseAuction: settled {} -> financedInvoice={}", contractId, fiCidStr);
                        return (Void) null;
                    });
        }).exceptionally(e -> {
            logger.error("autoCloseAuction: failed to auto-close {}: {}", contractId, e.getMessage(), e);
            return null;
        });
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /** Clears auction state from memory and DB after close/cancel. */
    private void cleanupAuction(String contractId) {
        auctionBidStore.clearAuction(contractId);
        auctionEndTimes.remove(contractId);
        auctionOwner.remove(contractId);
        try {
            jdbcTemplate.update("DELETE FROM auction_end_times WHERE contract_id = ?", contractId);
            jdbcTemplate.update("DELETE FROM auction_owners WHERE contract_id = ?", contractId);
        } catch (Exception e) {
            logger.warn("cleanupAuction: failed to delete from DB — {}", e.getMessage());
        }
    }

    private void persistAuctionEndTime(String contractId, Instant endTime) {
        try {
            jdbcTemplate.update(
                "INSERT INTO auction_end_times(contract_id, end_epoch_sec) VALUES(?,?) " +
                "ON CONFLICT(contract_id) DO UPDATE SET end_epoch_sec = EXCLUDED.end_epoch_sec",
                contractId, endTime.getEpochSecond());
        } catch (Exception e) {
            logger.warn("persistAuctionEndTime: failed — {}", e.getMessage());
        }
    }

    private void persistAuctionOwner(String contractId, String username) {
        try {
            jdbcTemplate.update(
                "INSERT INTO auction_owners(contract_id, username) VALUES(?,?) " +
                "ON CONFLICT(contract_id) DO UPDATE SET username = EXCLUDED.username",
                contractId, username);
        } catch (Exception e) {
            logger.warn("persistAuctionOwner: failed — {}", e.getMessage());
        }
    }

    private void persistFiOwner(String contractId, String companyUsername, String winnerUsername) {
        try {
            jdbcTemplate.update(
                "INSERT INTO fi_owners(contract_id, company_username, winner_username) VALUES(?,?,?) " +
                "ON CONFLICT(contract_id) DO UPDATE SET company_username=EXCLUDED.company_username, winner_username=EXCLUDED.winner_username",
                contractId, companyUsername, winnerUsername);
        } catch (Exception e) {
            logger.warn("persistFiOwner: failed — {}", e.getMessage());
        }
    }

    private void persistBoWinner(String contractId, String winnerUsername) {
        try {
            jdbcTemplate.update(
                "INSERT INTO bo_winners(contract_id, winner_username) VALUES(?,?) " +
                "ON CONFLICT(contract_id) DO UPDATE SET winner_username=EXCLUDED.winner_username",
                contractId, winnerUsername);
        } catch (Exception e) {
            logger.warn("persistBoWinner: failed — {}", e.getMessage());
        }
    }

    private void persistPaidOwner(String contractId, String companyUsername, String winnerUsername) {
        try {
            jdbcTemplate.update(
                "INSERT INTO paid_owners(contract_id, company_username, winner_username) VALUES(?,?,?) " +
                "ON CONFLICT(contract_id) DO UPDATE SET company_username=EXCLUDED.company_username, winner_username=EXCLUDED.winner_username",
                contractId, companyUsername, winnerUsername);
        } catch (Exception e) {
            logger.warn("persistPaidOwner: failed — {}", e.getMessage());
        }
    }

    // ── Trust score stat helpers ───────────────────────────────────────────────

    /** Increments the 6-month invoice counter when a new invoice is created. */
    private void incrementInvoices6mo(String username) {
        try {
            jdbcTemplate.update(
                "INSERT INTO supplier_trust_scores(username, invoices_6mo) VALUES(?,1) " +
                "ON CONFLICT(username) DO UPDATE SET invoices_6mo = supplier_trust_scores.invoices_6mo + 1",
                username);
        } catch (Exception e) {
            logger.warn("incrementInvoices6mo: {}", e.getMessage());
        }
    }

    /** Increments total_invoices and on_time_paid when a payment is received. */
    private void incrementPaidCount(String username) {
        try {
            jdbcTemplate.update(
                "INSERT INTO supplier_trust_scores(username, total_invoices, on_time_paid) VALUES(?,1,1) " +
                "ON CONFLICT(username) DO UPDATE SET " +
                "  total_invoices = supplier_trust_scores.total_invoices + 1, " +
                "  on_time_paid   = supplier_trust_scores.on_time_paid + 1",
                username);
        } catch (Exception e) {
            logger.warn("incrementPaidCount: {}", e.getMessage());
        }
    }

    /**
     * Resolves the eligible bank party IDs when none are specified by the company.
     */
    private List<String> resolveEligibleBanks(String supplierParty) {
        List<String> institutions = ProfileApiImpl.getInstitutionPartyIds();
        if (!institutions.isEmpty()) {
            return institutions;
        }
        String operatorParty = auth.getAppProviderPartyId();
        List<String> tenantParties = tenantRepo.getAllTenants().values().stream()
                .filter(t -> !t.isInternal())
                .map(TenantPropertiesRepository.TenantProperties::getPartyId)
                .filter(p -> p != null && !p.equals(operatorParty) && !p.equals(supplierParty))
                .toList();
        if (!tenantParties.isEmpty()) {
            return tenantParties;
        }
        return List.of(operatorParty);
    }

    // ── Buyer invoice tracking helpers ─────────────────────────────────────────

    /** Records a new invoice obligation for the buyer (when buyer confirms). */
    private void recordBuyerInvoiceReceived(String buyerId, String invoiceId) {
        try {
            jdbcTemplate.update(
                "INSERT INTO buyer_invoices(buyer_id, invoice_id, status, confirmed_on_time, created_epoch) " +
                "VALUES(?,?,'PENDING',true,?) " +
                "ON CONFLICT DO NOTHING",
                buyerId, invoiceId, System.currentTimeMillis() / 1000L);
            // Also upsert to increment total_received in trust scores
            jdbcTemplate.update(
                "INSERT INTO buyer_trust_scores(buyer_id, total_received, total_invoices_obligation) VALUES(?,1,1) " +
                "ON CONFLICT(buyer_id) DO UPDATE SET " +
                "  total_received = buyer_trust_scores.total_received + 1, " +
                "  total_invoices_obligation = buyer_trust_scores.total_invoices_obligation + 1",
                buyerId);
        } catch (Exception e) {
            logger.warn("recordBuyerInvoiceReceived: {}", e.getMessage());
        }
    }

    /** Records a buyer payment (when buyer pays a FinancedInvoice). */
    private void recordBuyerPaymentMade(String buyerId, String invoiceId, boolean onTime) {
        try {
            long now = System.currentTimeMillis() / 1000L;
            jdbcTemplate.update(
                "UPDATE buyer_invoices SET status='PAID', paid_on_time=?, paid_epoch=? " +
                "WHERE buyer_id=? AND invoice_id=?",
                onTime, now, buyerId, invoiceId);
            // Upsert stats increment
            jdbcTemplate.update(
                "INSERT INTO buyer_trust_scores(buyer_id, total_invoices_paid, total_payments, on_time_payments) VALUES(?,1,1,?) " +
                "ON CONFLICT(buyer_id) DO UPDATE SET " +
                "  total_invoices_paid = buyer_trust_scores.total_invoices_paid + 1, " +
                "  total_payments = buyer_trust_scores.total_payments + 1, " +
                "  on_time_payments = buyer_trust_scores.on_time_payments + ?",
                buyerId, onTime ? 1 : 0, onTime ? 1 : 0);
        } catch (Exception e) {
            logger.warn("recordBuyerPaymentMade: {}", e.getMessage());
        }
    }

    /** Computes a combined risk label from supplier and buyer tiers. */
    private static String computeCombinedRisk(String supplierTier, String buyerTier) {
        if (supplierTier == null) supplierTier = "PROVISIONAL";
        if (buyerTier == null) buyerTier = "PROVISIONAL";
        if ("UNRATED".equals(supplierTier) || "UNRATED".equals(buyerTier)) return "HIGH RISK";
        if ("PROVISIONAL".equals(supplierTier) && "PROVISIONAL".equals(buyerTier)) return "HIGH RISK";
        if ("PROVISIONAL".equals(supplierTier) || "PROVISIONAL".equals(buyerTier)) return "ELEVATED RISK";
        boolean sBothHighTier = "PLATINUM".equals(supplierTier) || "GOLD".equals(supplierTier);
        boolean bBothHighTier = "PLATINUM".equals(buyerTier) || "GOLD".equals(buyerTier);
        if (sBothHighTier && bBothHighTier) return "LOW RISK";
        if (("GOLD".equals(supplierTier) && "SILVER".equals(buyerTier)) ||
            ("SILVER".equals(supplierTier) && "GOLD".equals(buyerTier))) return "MEDIUM RISK";
        if ("SILVER".equals(supplierTier) || "SILVER".equals(buyerTier)) return "MEDIUM RISK";
        return "MEDIUM RISK";
    }

    private static int toIntVal(Object v) {
        if (v instanceof Number n) return n.intValue();
        return 0;
    }

    /**
     * Retries a ledger operation when Canton is temporarily unavailable (gRPC UNAVAILABLE).
     * Canton restarts every ~20-30s in the demo; retrying with a short delay allows the
     * operation to succeed once Canton comes back up.
     */
    private <T> CompletableFuture<T> withLedgerRetry(
            Supplier<CompletableFuture<T>> operation,
            int attemptsLeft,
            long delayMs) {
        return operation.get().exceptionallyCompose(ex -> {
            Throwable cause = ex instanceof java.util.concurrent.CompletionException ? ex.getCause() : ex;
            boolean isUnavailable = cause instanceof io.grpc.StatusRuntimeException sre &&
                    sre.getStatus().getCode() == io.grpc.Status.Code.UNAVAILABLE;
            if (!isUnavailable || attemptsLeft <= 1) {
                return CompletableFuture.failedFuture(ex);
            }
            logger.warn("Canton unavailable, retrying in {}ms ({} attempts left)...", delayMs, attemptsLeft - 1);
            var delayed = new CompletableFuture<Void>();
            CompletableFuture.delayedExecutor(delayMs, TimeUnit.MILLISECONDS)
                    .execute(() -> delayed.complete(null));
            return delayed.thenCompose(v -> withLedgerRetry(operation, attemptsLeft - 1, delayMs));
        });
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
