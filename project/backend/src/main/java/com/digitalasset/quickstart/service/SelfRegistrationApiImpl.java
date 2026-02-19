package com.digitalasset.quickstart.service;

import com.digitalasset.quickstart.api.AuthApi;
import com.digitalasset.quickstart.repository.TenantPropertiesRepository;
import com.digitalasset.quickstart.security.AuthUtils;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import org.openapitools.jackson.nullable.JsonNullable;
import org.openapitools.model.SelfRegistrationRequest;
import org.openapitools.model.SelfRegistrationResult;
import org.openapitools.model.UserProfileDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.provisioning.UserDetailsManager;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Self-registration endpoint — allows Companies and Institutions to sign up directly
 * without admin intervention.
 *
 * <p>In shared-secret mode: creates a Spring Security user and registers a tenant
 * mapping the new user to the shared Canton party (pragmatic for hackathon demo).
 *
 * <p>In OAuth2 mode: returns 501 Not Implemented (Keycloak self-registration
 * requires separate admin-API integration).
 */
@Controller
@RequestMapping("${openapi.asset.base-path:}")
public class SelfRegistrationApiImpl implements AuthApi {

    private static final Logger logger = LoggerFactory.getLogger(SelfRegistrationApiImpl.class);

    private final Optional<UserDetailsManager> userDetailsManager;
    private final TenantPropertiesRepository tenantRepo;
    private final AuthUtils authUtils;

    @Autowired
    public SelfRegistrationApiImpl(
            Optional<UserDetailsManager> userDetailsManager,
            TenantPropertiesRepository tenantRepo,
            AuthUtils authUtils) {
        this.userDetailsManager = userDetailsManager;
        this.tenantRepo = tenantRepo;
        this.authUtils = authUtils;
    }

    @Override
    @WithSpan
    public CompletableFuture<ResponseEntity<SelfRegistrationResult>> registerUser(
            SelfRegistrationRequest req) {
        return CompletableFuture.supplyAsync(() -> {
            // OAuth2 mode: self-registration not supported
            if (userDetailsManager.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED,
                        "Self-registration is only supported in shared-secret auth mode. " +
                        "In OAuth2 mode, please contact an administrator.");
            }

            // Validate required fields
            if (req.getUsername() == null || req.getUsername().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Username is required");
            }
            if (req.getDisplayName() == null || req.getDisplayName().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Display name is required");
            }
            if (req.getType() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Type (COMPANY or INSTITUTION) is required");
            }
            String username = req.getUsername().trim().toLowerCase();
            if (!username.matches("[a-z0-9_-]+")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Username may only contain lowercase letters, digits, hyphens and underscores");
            }

            // Check username uniqueness
            UserDetailsManager udm = userDetailsManager.get();
            if (udm.userExists(username)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Username '" + username + "' is already taken");
            }

            // Use the shared operator party ID for all self-registered users.
            // In a production deployment this would allocate a brand-new Canton party per user.
            String partyId = authUtils.getAppProviderPartyId();
            String tenantId = "user-" + username;

            // Create Spring Security user
            String password = (req.getPassword() != null && !req.getPassword().isBlank())
                    ? "{noop}" + req.getPassword()
                    : "{noop}password"; // fallback for demo
            logger.info("registerUser: creating user={} tenantId={} type={}", username, tenantId, req.getType());
            udm.createUser(
                    org.springframework.security.core.userdetails.User
                            .withUsername(username)
                            .password(password)
                            .roles("USER")
                            .build()
            );

            // Register tenant so auth system can resolve party for this user
            TenantPropertiesRepository.TenantProperties props = new TenantPropertiesRepository.TenantProperties();
            props.setTenantId(tenantId);
            props.setPartyId(partyId);
            props.setWalletUrl("http://wallet.localhost:2000/");
            props.setInternal(false);
            props.setUsers(List.of(username));
            tenantRepo.addTenant(tenantId, props);

            // Create profile in the shared profile store
            UserProfileDto profile = new UserProfileDto();
            profile.setPartyId(partyId);
            profile.setDisplayName(req.getDisplayName());
            if (req.getType() != null) {
                profile.setType(UserProfileDto.TypeEnum.fromValue(req.getType().getValue()));
            }
            profile.setSector(nullable(req.getSector()));
            profile.setAnnualRevenue(nullable(req.getAnnualRevenue()));
            profile.setEmployeeCount(nullable(req.getEmployeeCount()));
            profile.setFoundedYear(nullable(req.getFoundedYear()));
            profile.setDescription(nullable(req.getDescription()));
            profile.setWebsite(nullable(req.getWebsite()));
            ProfileApiImpl.registerProfile(username, profile);

            SelfRegistrationResult result = new SelfRegistrationResult();

            result.setPartyId(partyId);
            result.setUsername(username);
            result.setProfile(profile);

            logger.info("registerUser: success user={} type={} partyId={}", username, req.getType(), partyId);
            return ResponseEntity.status(HttpStatus.CREATED).body(result);
        });
    }

    /** Unwraps a JsonNullable&lt;T&gt; to T or null. */
    private static <T> T nullable(JsonNullable<T> jn) {
        return (jn != null && jn.isPresent()) ? jn.get() : null;
    }
}
