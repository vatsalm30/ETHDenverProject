package com.digitalasset.quickstart.service;

import org.openapitools.jackson.nullable.JsonNullable;
import org.openapitools.model.BidStatusDto;
import org.openapitools.model.PlaceBidResult;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Thread-safe in-memory store for sealed-bid auction bids.
 *
 * Each institution can place one bid per auction (can update it).
 * The winner is always the institution with the lowest offeredRate.
 * Ties broken by insertion order (first-come-first-served).
 *
 * Privacy guarantee: this store NEVER exposes which institution placed which bid
 * except via getBidStatus() which only reveals the caller's own bid.
 */
@Component
public class AuctionBidStore {

    /** Internal record of bids for one auction. */
    private static class AuctionBids {
        // Ordered map: bidderKey (username) → offeredRate (insertion order for tie-breaking)
        final LinkedHashMap<String, Double> bids = new LinkedHashMap<>();
        String currentWinnerKey = null;
        double currentBestRate = Double.MAX_VALUE;
        final ReentrantLock lock = new ReentrantLock();

        void recomputeWinner() {
            currentWinnerKey = null;
            currentBestRate = Double.MAX_VALUE;
            // Insertion order means first bidder wins ties
            for (Map.Entry<String, Double> entry : bids.entrySet()) {
                if (entry.getValue() < currentBestRate) {
                    currentBestRate = entry.getValue();
                    currentWinnerKey = entry.getKey();
                }
            }
        }
    }

    private final ConcurrentHashMap<String, AuctionBids> auctionBidMap = new ConcurrentHashMap<>();

    private AuctionBids getOrCreate(String auctionContractId) {
        return auctionBidMap.computeIfAbsent(auctionContractId, k -> new AuctionBids());
    }

    /**
     * Place or update a sealed bid for an institution.
     *
     * @param auctionContractId the Daml contract ID of the FinancingAuction
     * @param bidderKey         the bidder's username (used as unique key per user)
     * @param offeredRate       advance rate e.g. 97.5 means 97.5%
     * @return PlaceBidResult indicating if this is currently the best bid
     */
    public PlaceBidResult placeBid(String auctionContractId, String bidderKey, double offeredRate) {
        AuctionBids auctionBids = getOrCreate(auctionContractId);
        auctionBids.lock.lock();
        try {
            auctionBids.bids.put(bidderKey, offeredRate);
            auctionBids.recomputeWinner();

            PlaceBidResult result = new PlaceBidResult();
            result.setIsCurrentBestBid(bidderKey.equals(auctionBids.currentWinnerKey));
            result.setCurrentBestRate(auctionBids.currentBestRate);
            return result;
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /**
     * Returns the calling institution's bid status.
     * Only reveals the caller's own rate; never reveals other bidders' rates or identities.
     */
    public BidStatusDto getBidStatus(String auctionContractId, String bidderKey) {
        AuctionBids auctionBids = auctionBidMap.get(auctionContractId);
        BidStatusDto dto = new BidStatusDto();

        if (auctionBids == null) {
            dto.setHasBid(false);
            dto.setIsWinning(false);
            return dto;
        }

        auctionBids.lock.lock();
        try {
            Double myRate = auctionBids.bids.get(bidderKey);
            dto.setHasBid(myRate != null);
            dto.setIsWinning(bidderKey.equals(auctionBids.currentWinnerKey));
            if (myRate != null) {
                dto.setMyRate(JsonNullable.of(myRate));
            }
            if (!auctionBids.bids.isEmpty()) {
                dto.setCurrentBestRate(JsonNullable.of(auctionBids.currentBestRate));
            }
            return dto;
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /**
     * Returns the current winner (lowest-rate bidder).
     */
    public Optional<WinnerInfo> getWinner(String auctionContractId) {
        AuctionBids auctionBids = auctionBidMap.get(auctionContractId);
        if (auctionBids == null) return Optional.empty();

        auctionBids.lock.lock();
        try {
            if (auctionBids.currentWinnerKey == null) return Optional.empty();
            return Optional.of(new WinnerInfo(auctionBids.currentWinnerKey, auctionBids.currentBestRate));
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /** Returns the current best rate, or empty if no bids placed. */
    public OptionalDouble getCurrentBestRate(String auctionContractId) {
        AuctionBids auctionBids = auctionBidMap.get(auctionContractId);
        if (auctionBids == null) return OptionalDouble.empty();

        auctionBids.lock.lock();
        try {
            if (auctionBids.bids.isEmpty()) return OptionalDouble.empty();
            return OptionalDouble.of(auctionBids.currentBestRate);
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /** Returns number of distinct bids placed on this auction. */
    public int getBidCount(String auctionContractId) {
        AuctionBids auctionBids = auctionBidMap.get(auctionContractId);
        if (auctionBids == null) return 0;

        auctionBids.lock.lock();
        try {
            return auctionBids.bids.size();
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /** Returns the average rate across all bids, or empty if no bids placed. */
    public OptionalDouble getAverageBid(String auctionContractId) {
        AuctionBids auctionBids = auctionBidMap.get(auctionContractId);
        if (auctionBids == null) return OptionalDouble.empty();
        auctionBids.lock.lock();
        try {
            if (auctionBids.bids.isEmpty()) return OptionalDouble.empty();
            double avg = auctionBids.bids.values().stream()
                    .mapToDouble(Double::doubleValue)
                    .average()
                    .orElse(Double.NaN);
            return Double.isNaN(avg) ? OptionalDouble.empty() : OptionalDouble.of(avg);
        } finally {
            auctionBids.lock.unlock();
        }
    }

    /**
     * Removes all bid state for an auction after it has been settled or cancelled.
     * Called by InvoiceFinanceApiImpl after closeAuction completes.
     */
    public void clearAuction(String auctionContractId) {
        auctionBidMap.remove(auctionContractId);
    }

    /** Stores the winning institution's username (bidder key) and their offered rate. */
    public record WinnerInfo(String username, double rate) {}
}
