package com.digitalasset.quickstart.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Mock EVM settlement service (Canton-first finality).
 *
 * After a Canton PaidInvoice is created, this service:
 *   1. Generates a deterministic mock Ethereum tx hash (SHA-256 of invoiceId + epoch).
 *   2. Persists a PENDING settlement record to evm_settlements DB table.
 *   3. Every 5s advances: PENDING → CONFIRMING (after 5s) → CONFIRMED (after 15s).
 *
 * No real blockchain calls. State persists across backend restarts.
 */
@Component
public class EvmSettlementService {

    private static final Logger logger = LoggerFactory.getLogger(EvmSettlementService.class);
    private static final long CONFIRMING_AFTER_SECS = 5L;
    private static final long CONFIRMED_AFTER_SECS  = 15L;

    public static final String STATE_PENDING    = "PENDING";
    public static final String STATE_CONFIRMING = "CONFIRMING";
    public static final String STATE_CONFIRMED  = "CONFIRMED";

    @Autowired private JdbcTemplate jdbcTemplate;

    @PostConstruct
    public void initSettlementTable() {
        try {
            jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS evm_settlements (" +
                "  invoice_id    TEXT PRIMARY KEY, " +
                "  tx_hash       TEXT NOT NULL, " +
                "  bridge_state  TEXT NOT NULL DEFAULT 'PENDING', " +
                "  created_epoch BIGINT NOT NULL)");
            logger.info("EvmSettlementService: evm_settlements table ready");
        } catch (Exception e) {
            logger.warn("EvmSettlementService: table init failed — {}", e.getMessage());
        }
    }

    /** Trigger after Canton PaidInvoice is committed. Thread-safe. */
    public void triggerSettlement(String invoiceId) {
        long now = Instant.now().getEpochSecond();
        String txHash = generateMockTxHash(invoiceId, now);
        try {
            jdbcTemplate.update(
                "INSERT INTO evm_settlements(invoice_id, tx_hash, bridge_state, created_epoch) " +
                "VALUES(?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET " +
                "tx_hash=EXCLUDED.tx_hash, bridge_state='PENDING', created_epoch=EXCLUDED.created_epoch",
                invoiceId, txHash, STATE_PENDING, now);
            logger.info("EvmSettlementService: triggered invoiceId={} txHash={}...", invoiceId, txHash.substring(0, 12));
        } catch (Exception e) {
            logger.warn("EvmSettlementService: triggerSettlement failed invoiceId={} — {}", invoiceId, e.getMessage());
        }
    }

    /** Look up current settlement state. Returns empty for pre-feature invoices. */
    public Optional<SettlementRecord> getSettlement(String invoiceId) {
        try {
            var rows = jdbcTemplate.query(
                "SELECT invoice_id, tx_hash, bridge_state, created_epoch " +
                "FROM evm_settlements WHERE invoice_id = ?",
                (rs, i) -> new SettlementRecord(
                    rs.getString("invoice_id"), rs.getString("tx_hash"),
                    rs.getString("bridge_state"), rs.getLong("created_epoch")),
                invoiceId);
            return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
        } catch (Exception e) {
            logger.warn("EvmSettlementService: getSettlement failed invoiceId={} — {}", invoiceId, e.getMessage());
            return Optional.empty();
        }
    }

    /** Every 5 seconds: advance PENDING→CONFIRMING (5s), CONFIRMING→CONFIRMED (15s). */
    @Scheduled(fixedDelay = 5000)
    public void advanceSettlementStates() {
        long now = Instant.now().getEpochSecond();
        try {
            int a = jdbcTemplate.update(
                "UPDATE evm_settlements SET bridge_state=? WHERE bridge_state=? AND (?-created_epoch)>=?",
                STATE_CONFIRMING, STATE_PENDING, now, CONFIRMING_AFTER_SECS);
            int b = jdbcTemplate.update(
                "UPDATE evm_settlements SET bridge_state=? WHERE bridge_state=? AND (?-created_epoch)>=?",
                STATE_CONFIRMED, STATE_CONFIRMING, now, CONFIRMED_AFTER_SECS);
            if (a + b > 0)
                logger.info("EvmSettlementService: {}→CONFIRMING, {}→CONFIRMED", a, b);
        } catch (Exception e) {
            logger.warn("EvmSettlementService: advanceSettlementStates failed — {}", e.getMessage());
        }
    }

    private String generateMockTxHash(String invoiceId, long epochSeconds) {
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            byte[] hash = sha256.digest((invoiceId + ":" + epochSeconds)
                    .getBytes(StandardCharsets.UTF_8));
            return "0x" + HexFormat.of().formatHex(hash); // 0x + 64 hex chars
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 unavailable", e);
        }
    }

    public record SettlementRecord(String invoiceId, String txHash, String bridgeState, long createdEpoch) {}
}
