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

    /** Returns the party IDs of all registered INSTITUTION profiles. */
    public static List<String> getInstitutionPartyIds() {
        return profiles.entrySet().stream()
                .filter(e -> UserProfileDto.TypeEnum.INSTITUTION.equals(e.getValue().getType()))
                .map(java.util.Map.Entry::getKey)
                .toList();
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> getMyProfile() {
        return auth.asAuthenticatedParty(party -> {
            UserProfileDto profile = profiles.get(party);
            if (profile == null) {
                return CompletableFuture.completedFuture(ResponseEntity.notFound().<UserProfileDto>build());
            }
            return CompletableFuture.completedFuture(ResponseEntity.ok(profile));
        });
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> upsertMyProfile(UpdateProfileRequest req) {
        return auth.asAuthenticatedParty(party -> {
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
            profiles.put(party, profile);
            return CompletableFuture.completedFuture(ResponseEntity.ok(profile));
        });
    }

    @Override
    public CompletableFuture<ResponseEntity<UserProfileDto>> getProfile(String partyId) {
        return auth.asAuthenticatedParty(party -> {
            UserProfileDto profile = profiles.get(partyId);
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
