// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.api.LoginLinksApi;
import com.digitalasset.quickstart.security.oauth2.AuthClientRegistrationRepository;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import jakarta.servlet.http.HttpServletRequest;
import org.openapitools.model.LoginLink;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;


@Controller
@RequestMapping("${openapi.asset.base-path:}")
@Profile("oauth2")
public class LoginLinksApiImpl implements LoginLinksApi {

    private final AuthClientRegistrationRepository clientRegistrationRepository;
    private final HttpServletRequest request;

    public LoginLinksApiImpl(AuthClientRegistrationRepository clientRegistrationRepository,
                             HttpServletRequest request) {
        this.clientRegistrationRepository = clientRegistrationRepository;
        this.request = request;
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<List<LoginLink>>> listLinks() {
        String baseUrl = request.getScheme() + "://" + request.getServerName()
                + (request.getServerPort() != 80 && request.getServerPort() != 443
                        ? ":" + request.getServerPort() : "");
        return CompletableFuture.supplyAsync(() -> {
                    List<LoginLink> links = clientRegistrationRepository.getClientRegistrations().stream()
                            .map(registration -> {
                                String registrationUrl = clientRegistrationRepository
                                        .getRegistrationLink(registration.getRegistrationId(), baseUrl);
                                return new LoginLink()
                                        .name(registration.getTenantId())
                                        .url(clientRegistrationRepository.getLoginLink(registration.getRegistrationId()))
                                        .registrationUrl(registrationUrl);
                            })
                            .collect(Collectors.toList());

                    return ResponseEntity.ok(links);
                }
        );
    }
}
