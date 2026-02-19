// Copyright (c) 2026 ETHDenver Hackathon. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.api.ProfileApi;
import com.digitalasset.quickstart.api.ProfilesApi;
import com.digitalasset.quickstart.security.AuthUtils;
import org.openapitools.model.UpdateProfileRequest;
import org.openapitools.model.UserProfileDto;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory user profile store — company/institution info displayed on auction cards.
 */
@Controller
@RequestMapping("${openapi.asset.base-path:}")
public class ProfileApiImpl implements ProfileApi, ProfilesApi {

    private static final ConcurrentHashMap<String, UserProfileDto> profiles = new ConcurrentHashMap<>();

    private final AuthUtils auth;

    @Autowired
    public ProfileApiImpl(AuthUtils auth) {
        this.auth = auth;
    }

    /** Returns the username of the currently authenticated user, or null if unauthenticated. */
    private static String currentUserKey() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return (auth != null) ? auth.getName() : null;
    }

    /** Returns the party IDs of all registered INSTITUTION profiles (distinct). */
    public static List<String> getInstitutionPartyIds() {
        return profiles.values().stream()
                .filter(p -> UserProfileDto.TypeEnum.INSTITUTION.equals(p.getType()))
                .map(UserProfileDto::getPartyId)
                .filter(id -> id != null)
                .distinct()
                .toList();
    }

    /** Returns the display name for a party, or the party ID if no profile is registered. */
    public static String getDisplayName(String partyId) {
        return profiles.values().stream()
                .filter(p -> partyId.equals(p.getPartyId()))
                .findFirst()
                .map(p -> (p.getDisplayName() != null && !p.getDisplayName().isBlank()) ? p.getDisplayName() : partyId)
                .orElse(partyId);
    }

    /** Upserts a profile from registration data, keyed by username (called by SelfRegistrationApiImpl). */
    public static void registerProfile(String username, UserProfileDto profile) {
        profiles.put(username, profile);
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> getMyProfile() {
        return auth.asAuthenticatedParty(party -> {
            String key = currentUserKey();
            UserProfileDto profile = (key != null) ? profiles.get(key) : null;
            if (profile == null) {
                return CompletableFuture.completedFuture(ResponseEntity.notFound().<UserProfileDto>build());
            }
            return CompletableFuture.completedFuture(ResponseEntity.ok(profile));
        });
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> upsertMyProfile(UpdateProfileRequest req) {
        return auth.asAuthenticatedParty(party -> {
            String key = currentUserKey();
            if (key == null) {
                return CompletableFuture.completedFuture(ResponseEntity.status(HttpStatus.UNAUTHORIZED).<UserProfileDto>build());
            }
            UserProfileDto profile = new UserProfileDto();
            profile.setPartyId(party);
            profile.setDisplayName(req.getDisplayName());
            profile.setType(req.getType() == null ? null :
                    UserProfileDto.TypeEnum.fromValue(req.getType().getValue()));
            profile.setSector(req.getSector());
            profile.setAnnualRevenue(req.getAnnualRevenue());
            profile.setEmployeeCount(req.getEmployeeCount());
            profile.setFoundedYear(req.getFoundedYear());
            profile.setDescription(req.getDescription());
            profile.setWebsite(req.getWebsite());
            profiles.put(key, profile);
            return CompletableFuture.completedFuture(ResponseEntity.ok(profile));
        });
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> getProfile(String partyId) {
        return auth.asAuthenticatedParty(party -> {
            UserProfileDto profile = profiles.values().stream()
                    .filter(p -> partyId.equals(p.getPartyId()))
                    .findFirst()
                    .orElse(null);
            if (profile == null) {
                // Return a stub so the UI can still show the party ID
                UserProfileDto stub = new UserProfileDto();
                stub.setPartyId(partyId);
                stub.setDisplayName(partyId);
                return CompletableFuture.completedFuture(ResponseEntity.ok(stub));
            }
            return CompletableFuture.completedFuture(ResponseEntity.ok(profile));
        });
    }
}
