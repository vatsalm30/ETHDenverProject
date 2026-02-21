// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * HTTP client for the Node.js ZK Buyer Trust Score service (port 3003).
 *
 * Falls back gracefully to a default PROVISIONAL score when the ZK service
 * is unreachable so the Canton backend never crashes because of it.
 *
 * Rule: buyer is NEVER blocked from confirming an invoice.
 * UNRATED buyers are flagged as HIGH_RISK on the auction so banks can decide.
 */
@Component
public class BuyerZkServiceClient {

    private static final Logger logger = LoggerFactory.getLogger(BuyerZkServiceClient.class);

    @Value("${zk.buyer.service.url:http://localhost:3003}")
    private String zkBuyerServiceUrl;

    private final HttpClient   httpClient   = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ── Response POJO ─────────────────────────────────────────────────────────

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BuyerZkTrustScore {
        public String  buyer;

        @JsonProperty("proof1_paymentHistoryPass") public Boolean proof1PaymentHistoryPass;
        @JsonProperty("proof2_confirmRatePass")    public Boolean proof2ConfirmRatePass;
        @JsonProperty("proof3_disputeRecordPass")  public Boolean proof3DisputeRecordPass;
        @JsonProperty("proof4_timelinessPass")     public Boolean proof4TimelinessPass;

        @JsonProperty("proof1_status") public String proof1Status = "PENDING";
        @JsonProperty("proof2_status") public String proof2Status = "PENDING";
        @JsonProperty("proof3_status") public String proof3Status = "PENDING";
        @JsonProperty("proof4_status") public String proof4Status = "PENDING";

        @JsonProperty("proof1_points") public int proof1Points;
        @JsonProperty("proof2_points") public int proof2Points;
        @JsonProperty("proof3_points") public int proof3Points;
        @JsonProperty("proof4_points") public int proof4Points;

        @JsonProperty("totalScore")       public int     totalScore;
        @JsonProperty("maxPossibleScore") public int     maxPossibleScore;
        @JsonProperty("pendingCount")     public int     pendingCount = 4;

        @JsonProperty("tier")            public String  tier      = "PROVISIONAL";
        @JsonProperty("certified")       public boolean certified = false;
        @JsonProperty("reason")          public String  reason;

        @JsonProperty("allProofsValid")  public boolean allProofsValid = true;
        @JsonProperty("timestamp")       public String  timestamp;
    }

    // ── Default score returned when ZK service is down ────────────────────────

    public static BuyerZkTrustScore defaultProvisional(String buyer, String reason) {
        var s = new BuyerZkTrustScore();
        s.buyer          = buyer;
        s.proof1Status   = "PENDING";
        s.proof2Status   = "PENDING";
        s.proof3Status   = "PENDING";
        s.proof4Status   = "PENDING";
        s.totalScore     = 0;
        s.maxPossibleScore = 0;
        s.pendingCount   = 4;
        s.tier           = "PROVISIONAL";
        s.certified      = false;
        s.reason         = reason != null ? reason : "Buyer trust service temporarily unavailable";
        s.allProofsValid = false;
        s.timestamp      = Instant.now().toString();
        return s;
    }

    // ── Main call ─────────────────────────────────────────────────────────────

    /**
     * Calls POST /trust-score/buyer on the ZK buyer service.
     * Returns a CompletableFuture that always completes (never exceptionally):
     * on any network or parse error it returns a default PROVISIONAL score.
     */
    public CompletableFuture<BuyerZkTrustScore> getBuyerTrustScore(
            String buyer,
            int    totalInvoicesPaid,
            int    totalInvoicesObligation,
            int    confirmedCount,
            int    totalReceived,
            int    totalDisputes,
            int    onTimePayments,
            int    totalPayments) {

        var body = Map.of(
                "buyer",                    buyer,
                "totalInvoicesPaid",        totalInvoicesPaid,
                "totalInvoicesObligation",  totalInvoicesObligation,
                "confirmedCount",           confirmedCount,
                "totalReceived",            totalReceived,
                "totalDisputes",            totalDisputes,
                "onTimePayments",           onTimePayments,
                "totalPayments",            totalPayments
        );

        return CompletableFuture.supplyAsync(() -> {
            try {
                String requestBody = objectMapper.writeValueAsString(body);
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(zkBuyerServiceUrl + "/trust-score/buyer"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                        .build();

                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

                if (resp.statusCode() != 200) {
                    logger.warn("ZK buyer service returned HTTP {} for buyer {}", resp.statusCode(), buyer);
                    return defaultProvisional(buyer, "ZK buyer service error (HTTP " + resp.statusCode() + ")");
                }

                BuyerZkTrustScore score = objectMapper.readValue(resp.body(), BuyerZkTrustScore.class);
                logger.info("ZK buyer trust score for {}: tier={} score={}/{} pending={}",
                        buyer, score.tier, score.totalScore, score.maxPossibleScore, score.pendingCount);
                return score;

            } catch (Exception e) {
                logger.warn("ZK buyer service unreachable for buyer {}: {}", buyer, e.getMessage());
                return defaultProvisional(buyer, "ZK buyer service temporarily unavailable");
            }
        });
    }
}
