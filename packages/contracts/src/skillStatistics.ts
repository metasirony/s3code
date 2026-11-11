import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  MessageId,
  NodeId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
} from "./baseSchemas.ts";

export class SkillStatisticsReadError extends Schema.TaggedError<SkillStatisticsReadError>()(
  "SkillStatisticsReadError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to read skill statistics.";
  }
}

export const SkillIdentity = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.String,
  scope: Schema.String,
  pluginId: Schema.NullOr(Schema.String),
});
export type SkillIdentity = typeof SkillIdentity.Type;

export const SkillInvocation = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  runId: RunId,
  // Native children have no app run; ancestry is frozen when their provider turn starts.
  nativeAncestry: Schema.optional(
    Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        runId: RunId,
        providerTurnId: ProviderTurnId,
        subagentId: NodeId,
      }),
    ),
  ),
  providerTurnId: Schema.NullOr(ProviderTurnId),
  messageId: Schema.NullOr(MessageId),
  turnItemId: Schema.NullOr(TurnItemId),
  nativeItemId: Schema.NullOr(Schema.String),
  occurrence: NonNegativeInt,
  source: Schema.Literals(["user_requested", "agent_observed"]),
  skill: SkillIdentity,
  observedAt: Schema.String,
});
export type SkillInvocation = typeof SkillInvocation.Type;

export const SkillStatisticsScope = Schema.Literals(["own", "inclusive"]);
export type SkillStatisticsScope = typeof SkillStatisticsScope.Type;

export const GetSkillStatisticsInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  runId: Schema.optional(RunId),
  providerTurnId: Schema.optional(ProviderTurnId),
  /**
   * `own` counts the executor thread. `inclusive` also counts descendants
   * credited to the selected thread or run when the observation was recorded.
   * With neither id, each observation is counted once on its executor.
   */
  scope: Schema.optional(SkillStatisticsScope),
});
export type GetSkillStatisticsInput = typeof GetSkillStatisticsInput.Type;

const Counts = Schema.Struct({
  total: NonNegativeInt,
  userRequested: NonNegativeInt,
  agentObserved: NonNegativeInt,
});
export const SkillStatistics = Schema.Struct({
  scope: SkillStatisticsScope,
  ...Counts.fields,
  skills: Schema.Array(Schema.Struct({ skill: SkillIdentity, ...Counts.fields })),
  nativeTurns: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      providerTurnId: ProviderTurnId,
      bindingRunId: RunId,
      active: Schema.Boolean,
      ...Counts.fields,
    }),
  ),
  executors: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      runId: RunId,
      role: Schema.Literals(["self", "descendant"]),
      origin: Schema.Literals(["root", "provider_native", "app_owned"]),
      ...Counts.fields,
    }),
  ),
  threads: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      ...Counts.fields,
      latestRunId: Schema.NullOr(RunId),
      latestRunCount: NonNegativeInt,
      beforeLatestRunCount: NonNegativeInt,
      activeRunIds: Schema.Array(RunId),
      latestNativeTurnId: Schema.NullOr(ProviderTurnId),
      latestNativeTurnCount: NonNegativeInt,
      beforeLatestNativeTurnCount: NonNegativeInt,
      activeNativeTurnIds: Schema.Array(ProviderTurnId),
    }),
  ),
  runs: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      runId: RunId,
      ...Counts.fields,
    }),
  ),
});
export type SkillStatistics = typeof SkillStatistics.Type;

export const GetSkillInvocationsInput = Schema.Struct({
  ...GetSkillStatisticsInput.fields,
  after: Schema.optional(NonNegativeInt),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 500 })),
  ),
});
export type GetSkillInvocationsInput = typeof GetSkillInvocationsInput.Type;
export const SkillInvocationsPage = Schema.Struct({
  invocations: Schema.Array(SkillInvocation),
  nextCursor: Schema.NullOr(NonNegativeInt),
});
export type SkillInvocationsPage = typeof SkillInvocationsPage.Type;
