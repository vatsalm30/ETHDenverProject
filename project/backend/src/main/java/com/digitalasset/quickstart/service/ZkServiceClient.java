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
 * HTTP client for the Node.js ZK Supplier Trust Score service (port 3001).
 *
 * Falls back gracefully to a default PROVISIONAL score when the ZK service
 * is unreachable so the Canton backend never crashes because of it.
 */
@Component
public class ZkServiceClient {

    private static final Logger logger = LoggerFactory.getLogger(ZkServiceClient.class);

    @Value("${zk.service.url:http://host.docker.internal:3001}")
    private String zkServiceUrl;

    private final HttpClient  httpClient   = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ── Response POJO ─────────────────────────────────────────────────────────

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ZkTrustScore {
        public String  supplier;

        @JsonProperty("proof1_invoiceLegitimate") public Boolean proof1InvoiceLegitimate;
        @JsonProperty("proof2_repaymentPass")     public Boolean proof2RepaymentPass;
        @JsonProperty("proof3_volumePass")        public Boolean proof3VolumePass;
        @JsonProperty("proof4_disputePass")       public Boolean proof4DisputePass;

        @JsonProperty("proof1_status") public String proof1Status = "PASS";
        @JsonProperty("proof2_status") public String proof2Status = "PENDING";
        @JsonProperty("proof3_status") public String proof3Status = "PENDING";
        @JsonProperty("proof4_status") public String proof4Status = "PENDING";

        @JsonProperty("proof1_points") public int proof1Points;
        @JsonProperty("proof2_points") public int proof2Points;
        @JsonProperty("proof3_points") public int proof3Points;
        @JsonProperty("proof4_points") public int proof4Points;

        @JsonProperty("totalScore")       public int totalScore;
        @JsonProperty("maxPossibleScore") public int maxPossibleScore;
        @JsonProperty("pendingCount")     public int pendingCount = 3;

        @JsonProperty("tier")            public String  tier            = "PROVISIONAL";
        @JsonProperty("certified")       public boolean certified        = false;
        @JsonProperty("reason")          public String  reason;
        @JsonProperty("invoiceValueCap") public Integer invoiceValueCap = 5000;

        @JsonProperty("allProofsValid")  public boolean allProofsValid  = true;
        @JsonProperty("timestamp")       public String  timestamp;
    }

    // ── Default score returned when ZK service is down ────────────────────────

    public static ZkTrustScore defaultProvisional(String supplier, String reason) {
        var s = new ZkTrustScore();
        s.supplier               = supplier;
        s.proof1Status           = "PASS";
        s.proof1InvoiceLegitimate = true;
        s.proof1Points           = 2;
        s.totalScore             = 2;
        s.maxPossibleScore       = 2;
        s.pendingCount           = 3;
        s.tier                   = "PROVISIONAL";
        s.certified              = false;
        s.reason                 = reason != null ? reason : "Trust service temporarily unavailable";
        s.invoiceValueCap        = 5000;
        s.allProofsValid         = false;
        s.timestamp              = Instant.now().toString();
        return s;
    }

    // ── Main call ─────────────────────────────────────────────────────────────

    /**
     * Calls POST /trust-score/supplier on the ZK service.
     * Returns a CompletableFuture that always completes (never exceptionally):
     * on any network or parse error it returns a default PROVISIONAL score.
     */
    public CompletableFuture<ZkTrustScore> getSupplierTrustScore(
            String supplier,
            String invoiceHash,
            int    onTimePaidCount,
            int    totalInvoiceCount,
            int    invoiceCountLast6Months,
            int    totalDisputes,
            String registryRoot) {

        var body = Map.of(
                "supplier",                supplier,
                "invoiceHash",             invoiceHash,
                "onTimePaidCount",         onTimePaidCount,
                "totalInvoiceCount",       totalInvoiceCount,
                "invoiceCountLast6Months", invoiceCountLast6Months,
                "totalDisputes",           totalDisputes,
                "registryRoot",            registryRoot
        );

        return CompletableFuture.supplyAsync(() -> {
            try {
                String requestBody = objectMapper.writeValueAsString(body);
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(zkServiceUrl + "/trust-score/supplier"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                        .build();

                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

                if (resp.statusCode() != 200) {
                    logger.warn("ZK service returned HTTP {} for supplier {}", resp.statusCode(), supplier);
                    return defaultProvisional(supplier, "ZK service error (HTTP " + resp.statusCode() + ")");
                }

                ZkTrustScore score = objectMapper.readValue(resp.body(), ZkTrustScore.class);
                logger.info("ZK trust score for {}: tier={} score={}/{} pending={}",
                        supplier, score.tier, score.totalScore, score.maxPossibleScore, score.pendingCount);
                return score;

            } catch (Exception e) {
                logger.warn("ZK service unreachable for supplier {}: {}", supplier, e.getMessage());
                return defaultProvisional(supplier, "ZK service temporarily unavailable");
            }
        });
    }
}
