// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.service.BuyerZkServiceClient.BuyerZkTrustScore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * GET  /trust-score/buyer/{buyerId}           — buyer's current trust score
 * POST /trust-score/buyer/{buyerId}/refresh   — force recalculation
 *
 * buyerId is the buyer party ID (Canton party string) or username.
 * Buyer trust scores are persisted to Postgres and survive restarts.
 * Score recalculates after every payment event.
 *
 * Rules:
 * - Buyer is NEVER blocked from confirming an invoice
 * - UNRATED buyers are flagged as HIGH_RISK on the auction (banks decide)
 * - PROVISIONAL buyers can still enter auctions (banks see the label)
 */
@RestController
@RequestMapping("/trust-score/buyer")
public class BuyerTrustController {

    private static final Logger logger = LoggerFactory.getLogger(BuyerTrustController.class);

    @Autowired private JdbcTemplate       jdbcTemplate;
    @Autowired private BuyerZkServiceClient buyerZkClient;

    // ── Read cached score ──────────────────────────────────────────────────────

    @GetMapping("/{buyerId}")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> getBuyerTrustScore(
            @PathVariable String buyerId) {
        return CompletableFuture.completedFuture(ResponseEntity.ok(loadOrDefault(buyerId)));
    }

    // ── Force recalculate ──────────────────────────────────────────────────────

    @PostMapping("/{buyerId}/refresh")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> refreshBuyerTrustScore(
            @PathVariable String buyerId) {

        int[] stats = getBuyerStats(buyerId);

        return buyerZkClient.getBuyerTrustScore(
                buyerId,
                stats[0], // totalInvoicesPaid
                stats[1], // totalInvoicesObligation
                stats[2], // confirmedCount
                stats[3], // totalReceived
                stats[4], // totalDisputes
                stats[5], // onTimePayments
                stats[6]  // totalPayments
        ).thenApply(score -> {
            persistScore(buyerId, score, stats);
            return ResponseEntity.ok(scoreToMap(buyerId, score));
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Derives buyer stats from the DB.
     * Returns [totalInvoicesPaid, totalInvoicesObligation, confirmedCount,
     *          totalReceived, totalDisputes, onTimePayments, totalPayments]
     *
     * Uses paid_owners to count paid invoices where the buyer was involved.
     * On-time payments proxied by count of paid invoices (demo simplification).
     */
    int[] getBuyerStats(String buyerId) {
        try {
            // Count invoices paid where this buyer is recorded
            Integer paidCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ? AND status = 'PAID'",
                    Integer.class, buyerId);
            Integer obligationCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ?",
                    Integer.class, buyerId);
            Integer confirmedCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ? AND confirmed_on_time = true",
                    Integer.class, buyerId);
            Integer receivedCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ?",
                    Integer.class, buyerId);
            Integer disputeCount = jdbcTemplate.queryForObject(
                    "SELECT COALESCE(SUM(disputes), 0) FROM buyer_invoices WHERE buyer_id = ?",
                    Integer.class, buyerId);
            Integer onTimeCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ? AND paid_on_time = true",
                    Integer.class, buyerId);
            Integer totalPayments = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM buyer_invoices WHERE buyer_id = ? AND status = 'PAID'",
                    Integer.class, buyerId);

            return new int[]{
                safe(paidCount),
                safe(obligationCount),
                safe(confirmedCount),
                safe(receivedCount),
                safe(disputeCount),
                safe(onTimeCount),
                safe(totalPayments),
            };
        } catch (Exception e) {
            logger.warn("getBuyerStats: {}", e.getMessage());
        }
        return new int[]{0, 0, 0, 0, 0, 0, 0};
    }

    private static int safe(Integer v) { return v != null ? v : 0; }

    /** Upserts buyer trust score + live stats into persistence table. */
    void persistScore(String buyerId, BuyerZkTrustScore s, int[] stats) {
        try {
            jdbcTemplate.update(
                "INSERT INTO buyer_trust_scores(" +
                "  buyer_id, tier, certified, total_score, max_score, pending_count, reason, " +
                "  proof1_status, proof2_status, proof3_status, proof4_status, " +
                "  proof1_points, proof2_points, proof3_points, proof4_points, " +
                "  total_invoices_paid, total_invoices_obligation, confirmed_count, " +
                "  total_received, total_disputes, on_time_payments, total_payments, " +
                "  last_calculated) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
                "ON CONFLICT(buyer_id) DO UPDATE SET " +
                "  tier=EXCLUDED.tier, certified=EXCLUDED.certified, " +
                "  total_score=EXCLUDED.total_score, max_score=EXCLUDED.max_score, " +
                "  pending_count=EXCLUDED.pending_count, reason=EXCLUDED.reason, " +
                "  proof1_status=EXCLUDED.proof1_status, proof2_status=EXCLUDED.proof2_status, " +
                "  proof3_status=EXCLUDED.proof3_status, proof4_status=EXCLUDED.proof4_status, " +
                "  proof1_points=EXCLUDED.proof1_points, proof2_points=EXCLUDED.proof2_points, " +
                "  proof3_points=EXCLUDED.proof3_points, proof4_points=EXCLUDED.proof4_points, " +
                "  total_invoices_paid=EXCLUDED.total_invoices_paid, " +
                "  total_invoices_obligation=EXCLUDED.total_invoices_obligation, " +
                "  confirmed_count=EXCLUDED.confirmed_count, " +
                "  total_received=EXCLUDED.total_received, " +
                "  total_disputes=EXCLUDED.total_disputes, " +
                "  on_time_payments=EXCLUDED.on_time_payments, " +
                "  total_payments=EXCLUDED.total_payments, " +
                "  last_calculated=EXCLUDED.last_calculated",
                buyerId, s.tier, s.certified, s.totalScore, s.maxPossibleScore,
                s.pendingCount, s.reason,
                s.proof1Status, s.proof2Status, s.proof3Status, s.proof4Status,
                s.proof1Points, s.proof2Points, s.proof3Points, s.proof4Points,
                stats.length > 0 ? stats[0] : 0,
                stats.length > 1 ? stats[1] : 0,
                stats.length > 2 ? stats[2] : 0,
                stats.length > 3 ? stats[3] : 0,
                stats.length > 4 ? stats[4] : 0,
                stats.length > 5 ? stats[5] : 0,
                stats.length > 6 ? stats[6] : 0,
                System.currentTimeMillis() / 1000L
            );
        } catch (Exception e) {
            logger.warn("persistScore (buyer): failed for {}: {}", buyerId, e.getMessage());
        }
    }

    /** Triggers async buyer ZK score calculation and persists without blocking. */
    public void triggerScoreRefresh(String buyerId) {
        int[] stats = getBuyerStats(buyerId);
        buyerZkClient.getBuyerTrustScore(
                buyerId,
                stats[0], stats[1], stats[2], stats[3], stats[4], stats[5], stats[6]
        ).thenAccept(score -> persistScore(buyerId, score, stats))
         .exceptionally(e -> { logger.warn("triggerScoreRefresh buyer {}: {}", buyerId, e.getMessage()); return null; });
    }

    /** Returns the buyer trust score from DB (camelCase JSON), or PROVISIONAL default. */
    public Map<String, Object> loadOrDefault(String buyerId) {
        try {
            var rows = jdbcTemplate.queryForList(
                    "SELECT * FROM buyer_trust_scores WHERE buyer_id = ?", buyerId);
            if (!rows.isEmpty()) {
                var r = rows.get(0);
                long lastCalc = r.get("last_calculated") instanceof Number n ? n.longValue() : 0L;
                return Map.ofEntries(
                    Map.entry("buyer",         buyerId),
                    Map.entry("tier",          r.getOrDefault("tier",         "PROVISIONAL")),
                    Map.entry("certified",     r.getOrDefault("certified",    false)),
                    Map.entry("totalScore",    toInt(r.get("total_score"))),
                    Map.entry("maxPossibleScore", toInt(r.get("max_score"))),
                    Map.entry("pendingCount",  toInt(r.get("pending_count"))),
                    Map.entry("reason",        r.getOrDefault("reason",       "")),
                    Map.entry("proof1_status", r.getOrDefault("proof1_status", "PENDING")),
                    Map.entry("proof2_status", r.getOrDefault("proof2_status", "PENDING")),
                    Map.entry("proof3_status", r.getOrDefault("proof3_status", "PENDING")),
                    Map.entry("proof4_status", r.getOrDefault("proof4_status", "PENDING")),
                    Map.entry("proof1_points", toInt(r.get("proof1_points"))),
                    Map.entry("proof2_points", toInt(r.get("proof2_points"))),
                    Map.entry("proof3_points", toInt(r.get("proof3_points"))),
                    Map.entry("proof4_points", toInt(r.get("proof4_points"))),
                    Map.entry("allProofsValid", true),
                    Map.entry("timestamp",     lastCalc > 0
                        ? java.time.Instant.ofEpochSecond(lastCalc).toString()
                        : java.time.Instant.now().toString())
                );
            }
        } catch (Exception e) {
            logger.warn("loadOrDefault (buyer): could not query DB for {}: {}", buyerId, e.getMessage());
        }
        return scoreToMap(buyerId, BuyerZkServiceClient.defaultProvisional(buyerId, "Score not yet calculated"));
    }

    /** Converts a BuyerZkTrustScore to a Map for JSON serialisation. */
    Map<String, Object> scoreToMap(String buyerId, BuyerZkTrustScore s) {
        return Map.ofEntries(
            Map.entry("buyer",           buyerId),
            Map.entry("tier",            s.tier     != null ? s.tier     : "PROVISIONAL"),
            Map.entry("certified",       s.certified),
            Map.entry("totalScore",      s.totalScore),
            Map.entry("maxPossibleScore", s.maxPossibleScore),
            Map.entry("pendingCount",    s.pendingCount),
            Map.entry("reason",          s.reason   != null ? s.reason   : ""),
            Map.entry("proof1_status",   s.proof1Status != null ? s.proof1Status : "PENDING"),
            Map.entry("proof2_status",   s.proof2Status != null ? s.proof2Status : "PENDING"),
            Map.entry("proof3_status",   s.proof3Status != null ? s.proof3Status : "PENDING"),
            Map.entry("proof4_status",   s.proof4Status != null ? s.proof4Status : "PENDING"),
            Map.entry("proof1_points",   s.proof1Points),
            Map.entry("proof2_points",   s.proof2Points),
            Map.entry("proof3_points",   s.proof3Points),
            Map.entry("proof4_points",   s.proof4Points),
            Map.entry("allProofsValid",  s.allProofsValid),
            Map.entry("timestamp",       s.timestamp != null ? s.timestamp : "")
        );
    }

    private static int toInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        return 0;
    }
}
