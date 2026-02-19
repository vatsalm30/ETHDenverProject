// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

package com.digitalasset.quickstart.ledger;

import com.daml.ledger.api.v2.*;
import com.digitalasset.quickstart.config.LedgerConfig;
import com.digitalasset.quickstart.security.AuthUtils;
import com.digitalasset.quickstart.security.TokenProvider;
import com.digitalasset.transcode.Converter;
import com.digitalasset.transcode.codec.proto.ProtobufCodec;
import com.digitalasset.transcode.java.Choice;
import com.digitalasset.transcode.java.ContractId;
import com.digitalasset.transcode.java.Template;
import com.digitalasset.transcode.java.Utils;
import com.digitalasset.transcode.schema.Dictionary;
import com.digitalasset.transcode.schema.Identifier;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;
import daml.Daml;
import io.grpc.*;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import javax.annotation.Nonnull;
import java.util.*;
import java.util.concurrent.CompletableFuture;

import static com.digitalasset.quickstart.utility.TracingUtils.*;

@Component
public class LedgerApi {
    private final String APP_ID;
    private final CommandSubmissionServiceGrpc.CommandSubmissionServiceFutureStub submission;
    private final CommandServiceGrpc.CommandServiceFutureStub commands;
    private final Dictionary<Converter<Object, ValueOuterClass.Value>> dto2Proto;
    private final Dictionary<Converter<ValueOuterClass.Value, Object>> proto2Dto;

    private final Logger logger = LoggerFactory.getLogger(LedgerApi.class);
    private final String appProviderParty;

    @Autowired
    public LedgerApi(LedgerConfig ledgerConfig, Optional<TokenProvider> tokenProvider, AuthUtils authUtils) {
        APP_ID = ledgerConfig.getApplicationId();
        appProviderParty = authUtils.getAppProviderPartyId();
        ManagedChannelBuilder<?> builder = ManagedChannelBuilder
                .forAddress(ledgerConfig.getHost(), ledgerConfig.getPort())
                .usePlaintext();
        if (tokenProvider.isEmpty()) {
            throw new IllegalStateException("TokenProvider is required for authentication");
        }
        builder.intercept(new Interceptor(tokenProvider.get()));
        ManagedChannel channel = builder.build();

        // Single log statement, not duplicating attributes for spans, so leaving as-is:
        logger.atInfo()
                .addKeyValue("host", ledgerConfig.getHost())
                .addKeyValue("port", ledgerConfig.getPort())
                .log("Connected to ledger");

        submission = CommandSubmissionServiceGrpc.newFutureStub(channel);
        commands = CommandServiceGrpc.newFutureStub(channel);

        ProtobufCodec protoCodec = new ProtobufCodec();
        dto2Proto = Utils.getConverters(Daml.ENTITIES, protoCodec);
        proto2Dto = Utils.getConverters(protoCodec, Daml.ENTITIES);
    }

    @WithSpan
    public <T extends Template> CompletableFuture<Void> create(
            T entity,
            String commandId
    ) {
        var ctx = tracingCtx(logger, "Creating contract",
                "commandId", commandId,
                "templateId", entity.templateId().toString(),
                "applicationId", APP_ID
        );
        return traceWithStartEvent(ctx, () -> {
            CommandsOuterClass.Command.Builder command = CommandsOuterClass.Command.newBuilder();
            ValueOuterClass.Value payload = dto2Proto.template(entity.templateId()).convert(entity);
            command.getCreateBuilder().setTemplateId(toIdentifier(entity.templateId())).setCreateArguments(payload.getRecord());
            return submitCommands(List.of(command.build()), commandId).thenApply(submitResponse -> null);
        });
    }

    /**
     * Creates a contract and returns its ContractId by waiting for the ledger confirmation.
     * More reliable than fire-and-forget {@link #create} when the caller needs the resulting ID.
     */
    @WithSpan
    public <T extends Template> CompletableFuture<ContractId<T>> createAndGetId(
            T entity,
            String commandId
    ) {
        var ctx = tracingCtx(logger, "CreateAndGetId",
                "commandId", commandId,
                "templateId", entity.templateId().toString()
        );
        return trace(ctx, () -> {
            ValueOuterClass.Value payload = dto2Proto.template(entity.templateId()).convert(entity);

            CommandsOuterClass.Command.Builder cmdBuilder = CommandsOuterClass.Command.newBuilder();
            cmdBuilder.getCreateBuilder()
                    .setTemplateId(toIdentifier(entity.templateId()))
                    .setCreateArguments(payload.getRecord());

            CommandsOuterClass.Commands commandsMsg = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addCommands(cmdBuilder.build())
                    .build();

            var eventFormat = TransactionFilterOuterClass.EventFormat.newBuilder()
                    .putFiltersByParty(appProviderParty, TransactionFilterOuterClass.Filters.newBuilder().build())
                    .build();
            var transactionFormat = TransactionFilterOuterClass.TransactionFormat.newBuilder()
                    .setEventFormat(eventFormat)
                    .setTransactionShape(TransactionFilterOuterClass.TransactionShape.TRANSACTION_SHAPE_LEDGER_EFFECTS)
                    .build();

            CommandServiceOuterClass.SubmitAndWaitForTransactionRequest request =
                    CommandServiceOuterClass.SubmitAndWaitForTransactionRequest.newBuilder()
                            .setCommands(commandsMsg)
                            .setTransactionFormat(transactionFormat)
                            .build();

            return toCompletableFuture(commands.submitAndWaitForTransaction(request))
                    .thenApply(response -> {
                        var tx = response.getTransaction();
                        for (int i = 0; i < tx.getEventsCount(); i++) {
                            var event = tx.getEvents(i);
                            if (event.hasCreated()) {
                                return new ContractId<T>(event.getCreated().getContractId());
                            }
                        }
                        throw new IllegalStateException("No created event in createAndGetId response");
                    });
        });
    }

    /**
     * Creates a contract and immediately exercises a choice on it in a single atomic transaction.
     * Returns the exercise result (e.g. a new ContractId from a consuming choice).
     */
    @WithSpan
    public <T extends Template, Result, C extends Choice<T, Result>>
    CompletableFuture<Result> createAndExercise(
            T entity,
            C choice,
            String commandId
    ) {
        var ctx = tracingCtx(logger, "CreateAndExercise",
                "commandId", commandId,
                "templateId", entity.templateId().toString(),
                "choiceName", choice.choiceName()
        );
        return trace(ctx, () -> {
            ValueOuterClass.Value createPayload = dto2Proto.template(entity.templateId()).convert(entity);
            ValueOuterClass.Value choicePayload =
                    dto2Proto.choiceArgument(choice.templateId(), choice.choiceName()).convert(choice);

            CommandsOuterClass.Command.Builder cmdBuilder = CommandsOuterClass.Command.newBuilder();
            cmdBuilder.getCreateAndExerciseBuilder()
                    .setTemplateId(toIdentifier(entity.templateId()))
                    .setCreateArguments(createPayload.getRecord())
                    .setChoice(choice.choiceName())
                    .setChoiceArgument(choicePayload);

            CommandsOuterClass.Commands commandsMsg = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addCommands(cmdBuilder.build())
                    .build();

            var eventFormat = TransactionFilterOuterClass.EventFormat.newBuilder()
                    .putFiltersByParty(appProviderParty, TransactionFilterOuterClass.Filters.newBuilder().build())
                    .build();
            var transactionFormat = TransactionFilterOuterClass.TransactionFormat.newBuilder()
                    .setEventFormat(eventFormat)
                    .setTransactionShape(TransactionFilterOuterClass.TransactionShape.TRANSACTION_SHAPE_LEDGER_EFFECTS)
                    .build();

            CommandServiceOuterClass.SubmitAndWaitForTransactionRequest request =
                    CommandServiceOuterClass.SubmitAndWaitForTransactionRequest.newBuilder()
                            .setCommands(commandsMsg)
                            .setTransactionFormat(transactionFormat)
                            .build();

            return toCompletableFuture(commands.submitAndWaitForTransaction(request))
                    .thenApply(response -> {
                        // Find the exercise event and extract its result
                        var tx = response.getTransaction();
                        for (int i = 0; i < tx.getEventsCount(); i++) {
                            var event = tx.getEvents(i);
                            if (event.hasExercised()) {
                                ValueOuterClass.Value resultPayload = event.getExercised().getExerciseResult();
                                @SuppressWarnings("unchecked")
                                Result result = (Result) proto2Dto
                                        .choiceResult(choice.templateId(), choice.choiceName())
                                        .convert(resultPayload);
                                return result;
                            }
                        }
                        throw new IllegalStateException("No exercise event found in createAndExercise response");
                    });
        });
    }

    @WithSpan
    public <T extends Template, Result, C extends Choice<T, Result>>
    CompletableFuture<Result> exerciseAndGetResult(
            ContractId<T> contractId,
            C choice,
            String commandId
    ) {
        return exerciseAndGetResult(contractId, choice, commandId, List.of());
    }

    /**
     * Submit a create command acting as an additional party alongside the operator.
     * Used by invoice-finance flows where the supplier/buyer/bank must co-act.
     */
    @WithSpan
    public <T extends Template> CompletableFuture<Void> createAsParties(
            T entity,
            String commandId,
            List<String> actAsParties
    ) {
        var ctx = tracingCtx(logger, "Creating contract (multi-party)",
                "commandId", commandId,
                "templateId", entity.templateId().toString()
        );
        return traceWithStartEvent(ctx, () -> {
            CommandsOuterClass.Command.Builder command = CommandsOuterClass.Command.newBuilder();
            ValueOuterClass.Value payload = dto2Proto.template(entity.templateId()).convert(entity);
            command.getCreateBuilder()
                    .setTemplateId(toIdentifier(entity.templateId()))
                    .setCreateArguments(payload.getRecord());

            CommandsOuterClass.Commands.Builder commandsBuilder = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addCommands(command.build());
            for (String p : actAsParties) {
                commandsBuilder.addActAs(p);
            }
            CommandSubmissionServiceOuterClass.SubmitRequest request =
                    CommandSubmissionServiceOuterClass.SubmitRequest.newBuilder()
                            .setCommands(commandsBuilder.build())
                            .build();
            return toCompletableFuture(submission.submit(request)).thenApply(r -> null);
        });
    }

    /**
     * Exercise a choice acting as additional parties alongside the operator.
     */
    @WithSpan
    public <T extends Template, Result, C extends Choice<T, Result>>
    CompletableFuture<Result> exerciseAsParties(
            ContractId<T> contractId,
            C choice,
            String commandId,
            List<String> actAsParties
    ) {
        var ctx = tracingCtx(logger, "Exercising choice (multi-party)",
                "commandId", commandId,
                "contractId", contractId.getContractId,
                "choiceName", choice.choiceName()
        );
        return trace(ctx, () -> {
            CommandsOuterClass.Command.Builder cmdBuilder = CommandsOuterClass.Command.newBuilder();
            ValueOuterClass.Value payload =
                    dto2Proto.choiceArgument(choice.templateId(), choice.choiceName()).convert(choice);

            cmdBuilder.getExerciseBuilder()
                    .setTemplateId(toIdentifier(choice.templateId()))
                    .setContractId(contractId.getContractId)
                    .setChoice(choice.choiceName())
                    .setChoiceArgument(payload);

            CommandsOuterClass.Commands.Builder commandsBuilder = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addCommands(cmdBuilder.build());
            for (String p : actAsParties) {
                commandsBuilder.addActAs(p);
            }

            var eventFormat = TransactionFilterOuterClass.EventFormat.newBuilder()
                    .putFiltersByParty(appProviderParty, TransactionFilterOuterClass.Filters.newBuilder().build())
                    .build();
            var transactionShape = TransactionFilterOuterClass.TransactionShape.TRANSACTION_SHAPE_LEDGER_EFFECTS;
            var transactionFormat =
                    TransactionFilterOuterClass.TransactionFormat.newBuilder()
                            .setEventFormat(eventFormat)
                            .setTransactionShape(transactionShape)
                            .build();
            CommandServiceOuterClass.SubmitAndWaitForTransactionRequest request =
                    CommandServiceOuterClass.SubmitAndWaitForTransactionRequest.newBuilder()
                            .setCommands(commandsBuilder.build())
                            .setTransactionFormat(transactionFormat)
                            .build();

            return toCompletableFuture(commands.submitAndWaitForTransaction(request))
                    .thenApply(response -> {
                        TransactionOuterClass.Transaction tx = response.getTransaction();
                        int eventCount = tx.getEventsCount();
                        EventOuterClass.Event event = eventCount != 0 ? tx.getEvents(0) : null;
                        ValueOuterClass.Value resultPayload = event != null
                                ? event.getExercised().getExerciseResult()
                                : ValueOuterClass.Value.getDefaultInstance();
                        @SuppressWarnings("unchecked")
                        Result result = (Result) proto2Dto.choiceResult(choice.templateId(), choice.choiceName()).convert(resultPayload);
                        return result;
                    });
        });
    }

    @WithSpan
    public <T extends Template, Result, C extends Choice<T, Result>>
    CompletableFuture<Result> exerciseAndGetResult(
            ContractId<T> contractId,
            C choice,
            String commandId,
            List<CommandsOuterClass.DisclosedContract> disclosedContracts
    ) {
        var ctx = tracingCtx(logger, "Exercising choice",
                "commandId", commandId,
                "contractId", contractId.getContractId,
                "choiceName", choice.choiceName(),
                "templateId", choice.templateId().toString(),
                "applicationId", APP_ID
        );
        return trace(ctx, () -> {
            CommandsOuterClass.Command.Builder cmdBuilder = CommandsOuterClass.Command.newBuilder();
            ValueOuterClass.Value payload =
                    dto2Proto.choiceArgument(choice.templateId(), choice.choiceName()).convert(choice);

            cmdBuilder.getExerciseBuilder()
                    .setTemplateId(toIdentifier(choice.templateId()))
                    .setContractId(contractId.getContractId)
                    .setChoice(choice.choiceName())
                    .setChoiceArgument(payload);

            CommandsOuterClass.Commands.Builder commandsBuilder = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addCommands(cmdBuilder.build());

            if (disclosedContracts != null && !disclosedContracts.isEmpty()) {
                commandsBuilder.addAllDisclosedContracts(disclosedContracts);
            }

            var eventFormat = TransactionFilterOuterClass.EventFormat.newBuilder()
                    .putFiltersByParty(appProviderParty, TransactionFilterOuterClass.Filters.newBuilder().build())
                    .build();
            var transactionShape = TransactionFilterOuterClass.TransactionShape.TRANSACTION_SHAPE_LEDGER_EFFECTS;
            var transactionFormat =
                    TransactionFilterOuterClass.TransactionFormat.newBuilder()
                            .setEventFormat(eventFormat)
                            .setTransactionShape(transactionShape)
                            .build();
            CommandServiceOuterClass.SubmitAndWaitForTransactionRequest request =
                    CommandServiceOuterClass.SubmitAndWaitForTransactionRequest.newBuilder()
                            .setCommands(commandsBuilder.build())
                            .setTransactionFormat(transactionFormat)
                            .build();

            addEventWithAttributes(Span.current(), "built ledger submit request", Map.of());
            logger.info("Submitting ledger command");
            return toCompletableFuture(commands.submitAndWaitForTransaction(request))
                    .thenApply(response -> {
                        TransactionOuterClass.Transaction txTree = response.getTransaction();
                        long offset = txTree.getOffset();
                        String workflowId = txTree.getWorkflowId();
                        int eventCount = txTree.getEventsCount();
                        EventOuterClass.Event event = eventCount != 0 ? txTree.getEvents(0) : null;

                        Map<String, Object> completionAttrs = new HashMap<>();
                        completionAttrs.put("ledgerOffset", offset);
                        completionAttrs.put("workflowId", workflowId);

                        setSpanAttributes(Span.current(), completionAttrs);
                        logInfo(logger, "Exercised choice", completionAttrs);

                        ValueOuterClass.Value resultPayload = event != null ? event.getExercised().getExerciseResult() : ValueOuterClass.Value.getDefaultInstance();

                        @SuppressWarnings("unchecked")
                        Result result = (Result) proto2Dto.choiceResult(choice.templateId(), choice.choiceName()).convert(resultPayload);
                        return result;
                    });
        });
    }

    @WithSpan
    public CompletableFuture<CommandSubmissionServiceOuterClass.SubmitResponse> submitCommands(
            List<CommandsOuterClass.Command> cmds,
            String commandId
    ) {
        return submitCommands(cmds, commandId, List.of());
    }

    @WithSpan
    public CompletableFuture<CommandSubmissionServiceOuterClass.SubmitResponse> submitCommands(
            List<CommandsOuterClass.Command> cmds,
            String commandId,
            List<CommandsOuterClass.DisclosedContract> disclosedContracts
    ) {
        var ctx = tracingCtx(logger, "Submitting commands",
                "commands.count", cmds.size(),
                "commandId", commandId,
                "applicationId", APP_ID
        );
        return trace(ctx, () -> {
            CommandsOuterClass.Commands.Builder commandsBuilder = CommandsOuterClass.Commands.newBuilder()
                    .setCommandId(commandId)
                    .addActAs(appProviderParty)
                    .addReadAs(appProviderParty)
                    .addAllCommands(cmds);

            if (disclosedContracts != null && !disclosedContracts.isEmpty()) {
                commandsBuilder.addAllDisclosedContracts(disclosedContracts);
            }

            CommandSubmissionServiceOuterClass.SubmitRequest request =
                    CommandSubmissionServiceOuterClass.SubmitRequest.newBuilder()
                            .setCommands(commandsBuilder.build())
                            .build();

            return toCompletableFuture(submission.submit(request));
        });
    }


    private static <T> CompletableFuture<T> toCompletableFuture(ListenableFuture<T> listenableFuture) {
        CompletableFuture<T> completableFuture = new CompletableFuture<>();
        Futures.addCallback(listenableFuture, new FutureCallback<>() {
            @Override
            public void onSuccess(T result) {
                completableFuture.complete(result);
            }

            @Override
            public void onFailure(@Nonnull Throwable t) {
                completableFuture.completeExceptionally(t);
            }
        }, MoreExecutors.directExecutor());
        return completableFuture;
    }

    private static ValueOuterClass.Identifier toIdentifier(Identifier id) {
        return ValueOuterClass.Identifier.newBuilder()
                .setPackageId(id.packageNameAsPackageId())
                .setModuleName(id.moduleName())
                .setEntityName(id.entityName())
                .build();
    }


    private static class Interceptor implements ClientInterceptor {
        private final Metadata.Key<String> AUTHORIZATION_HEADER = Metadata.Key.of("Authorization", Metadata.ASCII_STRING_MARSHALLER);
        private final TokenProvider tokenProvider;

        public Interceptor(TokenProvider tokenProvider) {
            this.tokenProvider = tokenProvider;
        }

        @Override
        public <ReqT, RespT> ClientCall<ReqT, RespT> interceptCall(MethodDescriptor<ReqT, RespT> method, CallOptions callOptions, Channel next) {
            ClientCall<ReqT, RespT> clientCall = next.newCall(method, callOptions);
            return new ForwardingClientCall.SimpleForwardingClientCall<>(clientCall) {
                @Override
                public void start(Listener<RespT> responseListener, Metadata headers) {
                    headers.put(AUTHORIZATION_HEADER, "Bearer " + tokenProvider.getToken());
                    super.start(responseListener, headers);
                }
            };
        }
    }
}
