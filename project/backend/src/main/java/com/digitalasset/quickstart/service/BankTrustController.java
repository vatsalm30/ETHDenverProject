// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.service.BankZkServiceClient.BankTrustScore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Bank trust score REST endpoints.
 *
 * GET  /trust-score/bank/me           — current bank's full score (own view)
 * POST /trust-score/bank/me/refresh   — force recalculation
 * GET  /trust-score/bank/{bankId}/public — tier + certified only (supplier view)
 * GET  /trust-score/bank/all          — admin view: all banks
 */
@RestController
@RequestMapping("/trust-score/bank")
public class BankTrustController {

    private static final Logger logger = LoggerFactory.getLogger(BankTrustController.class);

    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private BankZkServiceClient zkClient;

    // ── Own score (full) ──────────────────────────────────────────────────────

    @GetMapping("/me")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> getMyBankScore() {
        String username = currentUsername();
        if (username == null) return CompletableFuture.completedFuture(ResponseEntity.status(401).build());
        return CompletableFuture.completedFuture(ResponseEntity.ok(loadOrDefault(username)));
    }

    // ── Force recalculate ─────────────────────────────────────────────────────

    @PostMapping("/me/refresh")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> refreshMyBankScore() {
        String username = currentUsername();
        if (username == null) return CompletableFuture.completedFuture(ResponseEntity.status(401).build());

        double reserves  = getReserves(username);
        double financing = getFinancingAmount(username);
        Long   regTs     = getRegistrationTimestamp(username);
        int    avgRate   = getNetworkAverageRate();
        int    lastRate  = getLastOfferedRate(username);

        return zkClient.getBankTrustScore(
                username, reserves, financing, regTs,
                System.currentTimeMillis() / 1000L, avgRate, lastRate
        ).thenApply(score -> {
            persistScore(username, score, reserves, financing, regTs, lastRate);
            return ResponseEntity.ok(fullScoreMap(username, score));
        });
    }

    // ── Public view (supplier sees only tier + certified) ─────────────────────

    @GetMapping("/{bankId}/public")
    public ResponseEntity<Map<String, Object>> getPublicBankScore(@PathVariable String bankId) {
        var full = loadOrDefault(bankId);
        Map<String, Object> pub = new LinkedHashMap<>();
        pub.put("bank", bankId);
        pub.put("tier", full.getOrDefault("tier", "SUSPENDED"));
        pub.put("certified", full.getOrDefault("certified", false));
        pub.put("canBid", full.getOrDefault("canBid", false));
        return ResponseEntity.ok(pub);
    }

    // ── Admin view — all banks ────────────────────────────────────────────────

    @GetMapping("/all")
    public ResponseEntity<Map<String, Object>> getAllBankScores() {
        List<Map<String, Object>> banks = new ArrayList<>();
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList("SELECT * FROM bank_trust_scores");
            for (Map<String, Object> r : rows) {
                banks.add(dbRowToMap(r));
            }
        } catch (Exception e) {
            logger.warn("getAllBankScores: {}", e.getMessage());
        }
        int certified = (int) banks.stream()
                .filter(b -> Boolean.TRUE.equals(b.get("certified"))).count();
        int avgRate = getNetworkAverageRate();
        return ResponseEntity.ok(Map.of(
                "banks", banks,
                "certifiedCount", certified,
                "networkAverageRate", avgRate
        ));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String currentUsername() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null ? auth.getName() : null;
    }

    Map<String, Object> loadOrDefault(String bankId) {
        try {
            var rows = jdbcTemplate.queryForList(
                    "SELECT * FROM bank_trust_scores WHERE username = ?", bankId);
            if (!rows.isEmpty()) {
                return dbRowToMap(rows.get(0));
            }
        } catch (Exception e) {
            logger.warn("loadOrDefault bank: {}", e.getMessage());
        }
        return fullScoreMap(bankId, BankZkServiceClient.blockedDefault(bankId, "Score not yet calculated"));
    }

    /** Called by InvoiceFinanceApiImpl before allowing a bid.
     *
     * @param offeredRateBasisPoints The bank's offered rate in basis points (e.g. 324 = 3.24%).
     *                               Pass 0 if the rate is not yet known (first-time refresh).
     */
    public CompletableFuture<BankTrustScore> verifyBankForBid(
            String bankId, double financingAmount, int offeredRateBasisPoints) {
        double reserves = getReserves(bankId);
        Long   regTs    = getRegistrationTimestamp(bankId);
        int    avgRate  = getNetworkAverageRate();

        return zkClient.getBankTrustScore(
                bankId, reserves, financingAmount, regTs,
                System.currentTimeMillis() / 1000L, avgRate, offeredRateBasisPoints
        ).thenApply(score -> {
            persistScore(bankId, score, reserves, financingAmount, regTs, offeredRateBasisPoints);
            return score;
        });
    }

    private double getReserves(String bankId) {
        try {
            Double val = jdbcTemplate.queryForObject(
                    "SELECT reserve_balance FROM bank_trust_scores WHERE username = ?",
                    Double.class, bankId);
            return val != null ? val : 1_000_000.0;
        } catch (Exception e) {
            return 1_000_000.0;
        }
    }

    private double getFinancingAmount(String bankId) {
        try {
            Double val = jdbcTemplate.queryForObject(
                    "SELECT financing_amount FROM bank_trust_scores WHERE username = ?",
                    Double.class, bankId);
            return val != null ? val : 100_000.0;
        } catch (Exception e) {
            return 100_000.0;
        }
    }

    Long getRegistrationTimestamp(String bankId) {
        try {
            Long val = jdbcTemplate.queryForObject(
                    "SELECT registration_ts FROM bank_trust_scores WHERE username = ?",
                    Long.class, bankId);
            return val;
        } catch (Exception e) {
            return System.currentTimeMillis() / 1000L - (31L * 86400);
        }
    }

    int getNetworkAverageRate() {
        try {
            Double avg = jdbcTemplate.queryForObject(
                    "SELECT AVG(last_offered_rate) FROM bank_trust_scores WHERE certified = true AND last_offered_rate > 0",
                    Double.class);
            return avg != null ? (int) Math.round(avg) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    int getLastOfferedRate(String bankId) {
        try {
            Integer val = jdbcTemplate.queryForObject(
                    "SELECT last_offered_rate FROM bank_trust_scores WHERE username = ?",
                    Integer.class, bankId);
            return val != null ? val : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    void persistScore(String bankId, BankTrustScore s,
                      double reserves, double financing, Long regTs, int offeredRate) {
        try {
            jdbcTemplate.update(
                "INSERT INTO bank_trust_scores(" +
                "  username, tier, certified, can_bid, total_score, reason, " +
                "  proofx_status, proofy_status, proofz_status, " +
                "  proofx_points, proofy_points, proofz_points, " +
                "  reserve_balance, financing_amount, registration_ts, last_offered_rate, " +
                "  last_calculated) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
                "ON CONFLICT(username) DO UPDATE SET " +
                "  tier=EXCLUDED.tier, certified=EXCLUDED.certified, can_bid=EXCLUDED.can_bid, " +
                "  total_score=EXCLUDED.total_score, reason=EXCLUDED.reason, " +
                "  proofx_status=EXCLUDED.proofx_status, proofy_status=EXCLUDED.proofy_status, " +
                "  proofz_status=EXCLUDED.proofz_status, " +
                "  proofx_points=EXCLUDED.proofx_points, proofy_points=EXCLUDED.proofy_points, " +
                "  proofz_points=EXCLUDED.proofz_points, " +
                "  reserve_balance=EXCLUDED.reserve_balance, financing_amount=EXCLUDED.financing_amount, " +
                "  registration_ts=EXCLUDED.registration_ts, last_offered_rate=EXCLUDED.last_offered_rate, " +
                "  last_calculated=EXCLUDED.last_calculated",
                bankId, s.tier, s.certified, s.canBid, s.totalScore, s.reason,
                s.proofXStatus, s.proofYStatus, s.proofZStatus,
                s.proofXPoints, s.proofYPoints, s.proofZPoints,
                reserves, financing, regTs, offeredRate,
                System.currentTimeMillis() / 1000L
            );
        } catch (Exception e) {
            logger.warn("persistScore bank: {}", e.getMessage());
        }
    }

    Map<String, Object> fullScoreMap(String bankId, BankTrustScore s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("bank", bankId);
        m.put("tier", s.tier != null ? s.tier : "SUSPENDED");
        m.put("certified", s.certified);
        m.put("canBid", s.canBid);
        m.put("totalScore", s.totalScore);
        m.put("reason", s.reason != null ? s.reason : "");
        m.put("proofX_status", s.proofXStatus != null ? s.proofXStatus : "FAIL");
        m.put("proofY_status", s.proofYStatus != null ? s.proofYStatus : "PENDING");
        m.put("proofZ_status", s.proofZStatus != null ? s.proofZStatus : "FAIL");
        m.put("proofX_points", s.proofXPoints);
        m.put("proofY_points", s.proofYPoints);
        m.put("proofZ_points", s.proofZPoints);
        m.put("allProofsValid", s.allProofsValid);
        m.put("timestamp", s.timestamp != null ? s.timestamp : "");
        return m;
    }

    private Map<String, Object> dbRowToMap(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("bank",           r.get("username"));
        m.put("tier",           r.getOrDefault("tier", "SUSPENDED"));
        m.put("certified",      r.getOrDefault("certified", false));
        m.put("canBid",         r.getOrDefault("can_bid", false));
        m.put("totalScore",     toInt(r.get("total_score")));
        m.put("reason",         r.getOrDefault("reason", ""));
        m.put("proofX_status",  r.getOrDefault("proofx_status", "FAIL"));
        m.put("proofY_status",  r.getOrDefault("proofy_status", "PENDING"));
        m.put("proofZ_status",  r.getOrDefault("proofz_status", "FAIL"));
        m.put("proofX_points",  toInt(r.get("proofx_points")));
        m.put("proofY_points",  toInt(r.get("proofy_points")));
        m.put("proofZ_points",  toInt(r.get("proofz_points")));
        m.put("allProofsValid", !"FAIL".equals(r.getOrDefault("proofx_status", "FAIL").toString()));
        long lc = r.get("last_calculated") instanceof Number n ? n.longValue() : 0L;
        m.put("timestamp",      lc > 0 ? java.time.Instant.ofEpochSecond(lc).toString()
                                        : java.time.Instant.now().toString());
        return m;
    }

    private static int toInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        return 0;
    }
}
