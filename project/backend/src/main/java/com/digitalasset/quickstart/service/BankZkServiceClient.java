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
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * HTTP client for the ZK Bank Trust Score service (port 3002).
 *
 * Unlike the supplier client, failure here blocks the bank from bidding entirely.
 * An unverified bank is a bigger risk than a supplier with a degraded score.
 */
@Component
public class BankZkServiceClient {

    private static final Logger logger = LoggerFactory.getLogger(BankZkServiceClient.class);

    @Value("${zk.bank.service.url:http://host.docker.internal:3002}")
    private String zkBankServiceUrl;

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BankTrustScore {
        public String bank;

        @JsonProperty("proofX_liquidityPass")  public Boolean proofXLiquidityPass;
        @JsonProperty("proofY_legitimacyPass") public Boolean proofYLegitimacyPass;
        @JsonProperty("proofZ_ratePass")       public Boolean proofZRatePass;

        @JsonProperty("proofX_status") public String proofXStatus = "FAIL";
        @JsonProperty("proofY_status") public String proofYStatus = "PENDING";
        @JsonProperty("proofZ_status") public String proofZStatus = "FAIL";

        @JsonProperty("proofX_points") public int proofXPoints;
        @JsonProperty("proofY_points") public int proofYPoints;
        @JsonProperty("proofZ_points") public int proofZPoints;

        @JsonProperty("totalScore") public int totalScore;

        @JsonProperty("tier")      public String  tier      = "SUSPENDED";
        @JsonProperty("certified") public boolean certified  = false;
        @JsonProperty("canBid")    public boolean canBid     = false;
        @JsonProperty("reason")    public String  reason;

        @JsonProperty("allProofsValid") public boolean allProofsValid = false;
        @JsonProperty("timestamp")      public String  timestamp;
    }

    /** Returns a fallback score when ZK service is unreachable — bidding still allowed. */
    public static BankTrustScore blockedDefault(String bank, String reason) {
        var s = new BankTrustScore();
        s.bank           = bank;
        s.proofXStatus   = "PENDING";
        s.proofYStatus   = "PENDING";
        s.proofZStatus   = "PENDING";
        s.totalScore     = 0;
        s.tier           = "PROBATIONARY";
        s.certified      = false;
        s.canBid         = true;
        s.reason         = reason != null ? reason : "Bank verification service unavailable — bidding allowed with unverified status";
        s.allProofsValid = false;
        s.timestamp      = java.time.Instant.now().toString();
        return s;
    }

    public CompletableFuture<BankTrustScore> getBankTrustScore(
            String bank,
            double reserveBalance,
            double financingAmount,
            Long registrationTimestamp,
            long currentTimestamp,
            int networkAverageRate,
            int offeredRateBasisPoints) {

        // Build body without Map.of() so we can include Long safely
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("bank",                  bank);
        body.put("reserveBalance",        reserveBalance);
        body.put("financingAmount",       financingAmount);
        body.put("registrationTimestamp", registrationTimestamp != null ? registrationTimestamp : 0L);
        body.put("currentTimestamp",      currentTimestamp);
        body.put("networkAverageRate",    networkAverageRate);
        body.put("offeredRate",           offeredRateBasisPoints);

        return CompletableFuture.supplyAsync(() -> {
            try {
                String requestBody = objectMapper.writeValueAsString(body);
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(zkBankServiceUrl + "/trust-score/bank"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                        .build();

                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

                if (resp.statusCode() != 200) {
                    logger.warn("Bank ZK service returned HTTP {} for bank {}", resp.statusCode(), bank);
                    return blockedDefault(bank, "Bank ZK service error (HTTP " + resp.statusCode() + ")");
                }

                BankTrustScore score = objectMapper.readValue(resp.body(), BankTrustScore.class);
                logger.info("Bank ZK score for {}: tier={} certified={} canBid={} score={}/3",
                        bank, score.tier, score.certified, score.canBid, score.totalScore);
                return score;

            } catch (Exception e) {
                logger.warn("Bank ZK service unreachable for {}: {} — BLOCKING bid", bank, e.getMessage());
                return blockedDefault(bank, "Bank verification service unreachable — bidding blocked");
            }
        });
    }
}
