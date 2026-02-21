// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.service.ZkServiceClient.ZkTrustScore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * GET  /trust-score/supplier/me              — current user's trust score
 * GET  /trust-score/supplier/{username}      — any supplier's trust score (by username)
 * POST /trust-score/supplier/me/refresh      — force recalculation for current user
 */
@RestController
@RequestMapping("/trust-score/supplier")
public class SupplierTrustController {

    private static final Logger logger = LoggerFactory.getLogger(SupplierTrustController.class);

    @Autowired private JdbcTemplate   jdbcTemplate;
    @Autowired private ZkServiceClient zkClient;

    // ── Read cached score ──────────────────────────────────────────────────────

    @GetMapping("/me")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> getMyTrustScore() {
        String username = currentUsername();
        if (username == null) return CompletableFuture.completedFuture(ResponseEntity.status(401).build());
        return CompletableFuture.completedFuture(ResponseEntity.ok(loadOrDefault(username)));
    }

    @GetMapping("/{username}")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> getTrustScore(@PathVariable String username) {
        return CompletableFuture.completedFuture(ResponseEntity.ok(loadOrDefault(username)));
    }

    // ── Force recalculate ──────────────────────────────────────────────────────

    @PostMapping("/me/refresh")
    public CompletableFuture<ResponseEntity<Map<String, Object>>> refreshMyTrustScore() {
        String username = currentUsername();
        if (username == null) return CompletableFuture.completedFuture(ResponseEntity.status(401).build());

        int[] stats = getStats(username);
        // Derive a stable invoiceHash from username (distinct from registryRoot)
        String invoiceHash = String.valueOf(Math.abs(username.hashCode()) + 100_000L);

        return zkClient.getSupplierTrustScore(
                username, invoiceHash,
                stats[0], stats[1], stats[2], stats[3],
                "1234567890"
        ).thenApply(score -> {
            persistScore(username, score, stats);
            return ResponseEntity.ok(scoreToMap(username, score));
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String currentUsername() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null ? auth.getName() : null;
    }

    /** Returns the trust score from DB (mapped to camelCase JSON keys), or a default PROVISIONAL if not yet calculated. */
    private Map<String, Object> loadOrDefault(String username) {
        try {
            var rows = jdbcTemplate.queryForList(
                    "SELECT * FROM supplier_trust_scores WHERE username = ?", username);
            if (!rows.isEmpty()) {
                var r = rows.get(0);
                // Map DB snake_case columns → camelCase JSON keys expected by the frontend
                String p1s = r.getOrDefault("proof1_status", "PASS").toString();
                String p2s = r.getOrDefault("proof2_status", "PENDING").toString();
                String p3s = r.getOrDefault("proof3_status", "PENDING").toString();
                String p4s = r.getOrDefault("proof4_status", "PENDING").toString();
                boolean allValid = !"FAIL".equals(p1s) && !"FAIL".equals(p2s)
                                && !"FAIL".equals(p3s) && !"FAIL".equals(p4s);
                long lastCalc = r.get("last_calculated") instanceof Number n ? n.longValue() : 0L;
                return Map.ofEntries(
                    Map.entry("supplier",         username),
                    Map.entry("tier",             r.getOrDefault("tier",    "PROVISIONAL")),
                    Map.entry("certified",        r.getOrDefault("certified", false)),
                    Map.entry("totalScore",       toInt(r.get("total_score"))),
                    Map.entry("maxPossibleScore", toInt(r.get("max_score"))),
                    Map.entry("pendingCount",     toInt(r.get("pending_count"))),
                    Map.entry("reason",           r.getOrDefault("reason",  "")),
                    Map.entry("invoiceValueCap",  r.get("invoice_value_cap")),
                    Map.entry("proof1_status",    p1s),
                    Map.entry("proof2_status",    p2s),
                    Map.entry("proof3_status",    p3s),
                    Map.entry("proof4_status",    p4s),
                    Map.entry("proof1_points",    toInt(r.get("proof1_points"))),
                    Map.entry("proof2_points",    toInt(r.get("proof2_points"))),
                    Map.entry("proof3_points",    toInt(r.get("proof3_points"))),
                    Map.entry("proof4_points",    toInt(r.get("proof4_points"))),
                    Map.entry("allProofsValid",   allValid),
                    Map.entry("timestamp",        lastCalc > 0
                        ? java.time.Instant.ofEpochSecond(lastCalc).toString()
                        : java.time.Instant.now().toString())
                );
            }
        } catch (Exception e) {
            logger.warn("loadOrDefault: could not query DB for {}: {}", username, e.getMessage());
        }
        return scoreToMap(username, ZkServiceClient.defaultProvisional(username, "Score not yet calculated"));
    }

    /**
     * Derives [onTimePaid, totalInvoices, invoices6mo, disputes] from real invoice activity.
     *
     * - totalInvoices  = paid + financed invoices owned by this supplier
     * - onTimePaid     = paid invoices (proxy: completed = paid on time for demo)
     * - invoices6mo    = total invoices as proxy for recent 6-month activity
     * - disputes       = 0 (no dispute tracking yet)
     */
    int[] getStats(String username) {
        try {
            Integer paid = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM paid_owners WHERE company_username = ?",
                    Integer.class, username);
            Integer financed = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM fi_owners WHERE company_username = ?",
                    Integer.class, username);

            int totalPaid     = paid     != null ? paid     : 0;
            int totalFinanced = financed != null ? financed : 0;
            int total         = totalPaid + totalFinanced;

            return new int[]{ totalPaid, total, total, 0 };
        } catch (Exception e) {
            logger.warn("getStats: {}", e.getMessage());
        }
        return new int[]{0, 0, 0, 0};
    }

    /** Upserts trust score + live stats into the persistence table. */
    void persistScore(String username, ZkTrustScore s, int[] stats) {
        try {
            int onTimePaid = stats.length > 0 ? stats[0] : 0;
            int totalInv   = stats.length > 1 ? stats[1] : 0;
            int inv6mo     = stats.length > 2 ? stats[2] : 0;
            int disputes   = stats.length > 3 ? stats[3] : 0;

            jdbcTemplate.update(
                "INSERT INTO supplier_trust_scores(" +
                "  username, tier, certified, total_score, max_score, pending_count, reason, " +
                "  invoice_value_cap, proof1_status, proof2_status, proof3_status, proof4_status, " +
                "  proof1_points, proof2_points, proof3_points, proof4_points, " +
                "  on_time_paid, total_invoices, invoices_6mo, total_disputes, last_calculated) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
                "ON CONFLICT(username) DO UPDATE SET " +
                "  tier=EXCLUDED.tier, certified=EXCLUDED.certified, " +
                "  total_score=EXCLUDED.total_score, max_score=EXCLUDED.max_score, " +
                "  pending_count=EXCLUDED.pending_count, reason=EXCLUDED.reason, " +
                "  invoice_value_cap=EXCLUDED.invoice_value_cap, " +
                "  proof1_status=EXCLUDED.proof1_status, proof2_status=EXCLUDED.proof2_status, " +
                "  proof3_status=EXCLUDED.proof3_status, proof4_status=EXCLUDED.proof4_status, " +
                "  proof1_points=EXCLUDED.proof1_points, proof2_points=EXCLUDED.proof2_points, " +
                "  proof3_points=EXCLUDED.proof3_points, proof4_points=EXCLUDED.proof4_points, " +
                "  on_time_paid=EXCLUDED.on_time_paid, total_invoices=EXCLUDED.total_invoices, " +
                "  invoices_6mo=EXCLUDED.invoices_6mo, total_disputes=EXCLUDED.total_disputes, " +
                "  last_calculated=EXCLUDED.last_calculated",
                username, s.tier, s.certified, s.totalScore, s.maxPossibleScore,
                s.pendingCount, s.reason, s.invoiceValueCap,
                s.proof1Status, s.proof2Status, s.proof3Status, s.proof4Status,
                s.proof1Points, s.proof2Points, s.proof3Points, s.proof4Points,
                onTimePaid, totalInv, inv6mo, disputes,
                System.currentTimeMillis() / 1000L
            );
        } catch (Exception e) {
            logger.warn("persistScore: failed for {}: {}", username, e.getMessage());
        }
    }

    /** Converts a ZkTrustScore to a Map for JSON serialisation. */
    Map<String, Object> scoreToMap(String username, ZkTrustScore s) {
        return Map.ofEntries(
            Map.entry("supplier",          username),
            Map.entry("tier",              s.tier != null ? s.tier : "PROVISIONAL"),
            Map.entry("certified",         s.certified),
            Map.entry("totalScore",        s.totalScore),
            Map.entry("maxPossibleScore",  s.maxPossibleScore),
            Map.entry("pendingCount",      s.pendingCount),
            Map.entry("reason",            s.reason != null ? s.reason : ""),
            Map.entry("invoiceValueCap",   s.invoiceValueCap != null ? s.invoiceValueCap : 5000),
            Map.entry("proof1_status",     s.proof1Status != null ? s.proof1Status : "PASS"),
            Map.entry("proof2_status",     s.proof2Status != null ? s.proof2Status : "PENDING"),
            Map.entry("proof3_status",     s.proof3Status != null ? s.proof3Status : "PENDING"),
            Map.entry("proof4_status",     s.proof4Status != null ? s.proof4Status : "PENDING"),
            Map.entry("proof1_points",     s.proof1Points),
            Map.entry("proof2_points",     s.proof2Points),
            Map.entry("proof3_points",     s.proof3Points),
            Map.entry("proof4_points",     s.proof4Points),
            Map.entry("allProofsValid",    s.allProofsValid),
            Map.entry("timestamp",         s.timestamp != null ? s.timestamp : "")
        );
    }

    private static int toInt(Object v) {
        if (v instanceof Number n) return n.intValue();
        return 0;
    }
}
