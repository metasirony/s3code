import {
  SkillInvocation,
  SkillIdentity,
  SkillStatisticsReadError,
  ThreadId,
  RunId,
  type GetSkillStatisticsInput,
  type GetSkillInvocationsInput,
  type SkillStatistics,
  type SkillInvocationsPage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeSkill = Schema.decodeEffect(Schema.fromJsonString(SkillIdentity));
const decodeInvocation = Schema.decodeEffect(Schema.fromJsonString(SkillInvocation));
const decodeRunIds = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(RunId)));

type Counts = {
  readonly total: number;
  readonly userRequested: number;
  readonly agentObserved: number;
};
const emptyCounts = (): Counts => ({ total: 0, userRequested: 0, agentObserved: 0 });
const addCounts = (a: Counts, b: Counts): Counts => ({
  total: a.total + b.total,
  userRequested: a.userRequested + b.userRequested,
  agentObserved: a.agentObserved + b.agentObserved,
});

export const makeSkillStatistics = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const counts = sql`COUNT(i.invocation_id) AS total,
    COALESCE(SUM(i.source = 'user_requested'), 0) AS userRequested,
    COALESCE(SUM(i.source = 'agent_observed'), 0) AS agentObserved`;
  const visible = (input: GetSkillStatisticsInput) => sql`
    t.deleted_at IS NULL AND r.status <> 'rolled_back'
    ${input.threadId === undefined ? sql`` : sql`AND r.thread_id = ${input.threadId}`}
    ${input.runId === undefined ? sql`` : sql`AND r.run_id = ${input.runId}`}`;

  const getSkillStatistics = Effect.fn("ProjectionStoreV2.getSkillStatistics")(function* (
    input: GetSkillStatisticsInput,
  ): Effect.fn.Return<SkillStatistics, SkillStatisticsReadError> {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const runs = yield* sql<Counts & { threadId: ThreadId; runId: RunId }>`
        SELECT r.thread_id AS threadId, r.run_id AS runId, ${counts}
        FROM orchestration_v2_projection_runs r
        JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
        LEFT JOIN orchestration_v2_skill_invocations i ON i.run_id = r.run_id AND i.thread_id = r.thread_id
        WHERE ${visible(input)}
        GROUP BY r.run_id ORDER BY r.thread_id, r.ordinal`;
          const skillRows = yield* sql<Counts & { skill: string }>`
        SELECT json_extract(MAX(i.payload_json), '$.skill') AS skill, ${counts}
        FROM orchestration_v2_skill_invocations i
        JOIN orchestration_v2_projection_runs r ON r.run_id = i.run_id AND r.thread_id = i.thread_id
        JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
        WHERE ${visible(input)} GROUP BY i.skill_key ORDER BY i.skill_key`;
          const threadRows = yield* sql<{
            threadId: ThreadId;
            latestRunId: RunId | null;
            activeRunIds: string;
          }>`
        SELECT t.thread_id AS threadId,
          (SELECT r.run_id FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id
            AND r.status <> 'rolled_back' ORDER BY r.ordinal DESC LIMIT 1) AS latestRunId,
          (SELECT json_group_array(r.run_id) FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id
            AND r.status IN ('preparing', 'running', 'waiting', 'interrupting')) AS activeRunIds
        FROM orchestration_v2_projection_threads t WHERE t.deleted_at IS NULL
        ${input.threadId === undefined ? sql`` : sql`AND t.thread_id = ${input.threadId}`}
        ${
          input.runId === undefined
            ? sql``
            : sql`AND EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs r
          WHERE r.thread_id = t.thread_id AND r.run_id = ${input.runId} AND r.status <> 'rolled_back'
        )`
        }
        ORDER BY t.thread_id`;
          const byThread = new Map<string, Counts>();
          const byRun = new Map<string, number>();
          for (const run of runs) {
            byThread.set(run.threadId, addCounts(byThread.get(run.threadId) ?? emptyCounts(), run));
            byRun.set(run.runId, run.total);
          }
          return {
            ...runs.reduce(addCounts, emptyCounts()),
            skills: yield* Effect.forEach(skillRows, (row) =>
              decodeSkill(row.skill).pipe(
                Effect.map((skill) => ({
                  skill,
                  total: row.total,
                  userRequested: row.userRequested,
                  agentObserved: row.agentObserved,
                })),
              ),
            ),
            runs,
            threads: yield* Effect.forEach(threadRows, (row) =>
              Effect.gen(function* () {
                const total = byThread.get(row.threadId) ?? emptyCounts();
                const latestRunCount =
                  row.latestRunId === null ? 0 : (byRun.get(row.latestRunId) ?? 0);
                return {
                  threadId: row.threadId,
                  ...total,
                  latestRunId: row.latestRunId,
                  latestRunCount,
                  beforeLatestRunCount: total.total - latestRunCount,
                  activeRunIds: yield* decodeRunIds(row.activeRunIds),
                };
              }),
            ),
          };
        }),
      )
      .pipe(Effect.mapError((cause) => new SkillStatisticsReadError({ cause })));
  });

  const getSkillInvocations = Effect.fn("ProjectionStoreV2.getSkillInvocations")(function* (
    input: GetSkillInvocationsInput,
  ): Effect.fn.Return<SkillInvocationsPage, SkillStatisticsReadError> {
    const limit = input.limit ?? 100;
    return yield* Effect.gen(function* () {
      const rows = yield* sql<{ sequence: number; payload_json: string }>`
        SELECT i.sequence, i.payload_json FROM orchestration_v2_skill_invocations i
        JOIN orchestration_v2_projection_runs r ON r.run_id = i.run_id AND r.thread_id = i.thread_id
        JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
        WHERE ${visible(input)} AND i.sequence > ${input.after ?? 0}
        ORDER BY i.sequence LIMIT ${limit + 1}`;
      return {
        invocations: yield* Effect.forEach(rows.slice(0, limit), (row) =>
          decodeInvocation(row.payload_json),
        ),
        nextCursor: rows.length > limit ? rows[limit - 1]!.sequence : null,
      };
    }).pipe(Effect.mapError((cause) => new SkillStatisticsReadError({ cause })));
  });
  return { getSkillStatistics, getSkillInvocations };
});
