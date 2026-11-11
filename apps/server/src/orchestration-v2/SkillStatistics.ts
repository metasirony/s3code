import {
  SkillInvocation,
  SkillIdentity,
  SkillStatisticsReadError,
  ThreadId,
  RunId,
  ProviderTurnId,
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
const encodeSkillInvocation = Schema.encodeEffect(Schema.fromJsonString(SkillInvocation));
const decodeRunIds = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(RunId)));

type Counts = {
  readonly total: number;
  readonly userRequested: number;
  readonly agentObserved: number;
};
const emptyCounts = (): Counts => ({ total: 0, userRequested: 0, agentObserved: 0 });

type CreditRole = "self" | "descendant";
type CreditOrigin = "root" | "provider_native" | "app_owned";
type SkillCredit = {
  readonly threadId: string;
  readonly runId: string;
  readonly providerTurnId: string | null;
  readonly role: CreditRole;
  readonly origin: CreditOrigin;
};
type TaskLink = {
  readonly threadId: string;
  readonly runId: string | null;
  readonly childThreadId: string | null;
  readonly origin: string;
};

const asOrigin = (origin: string | null | undefined): CreditOrigin =>
  origin === "provider_native" || origin === "app_owned" ? origin : "root";

const inclusiveOf = (input: GetSkillStatisticsInput) =>
  input.scope === "inclusive" &&
  (input.threadId !== undefined || input.runId !== undefined || input.providerTurnId !== undefined);

export const makeSkillStatistics = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const subagentById = (id: string) =>
    sql<TaskLink>`SELECT thread_id AS threadId, run_id AS runId, child_thread_id AS childThreadId, origin
      FROM orchestration_v2_projection_subagents WHERE subagent_id = ${id} LIMIT 1`;

  // Per-observation helper shares recordSkillInvocation's span. Follow-ups name their task;
  // spawn runs use the forked node, and restart continuations inherit their source run's task.
  const owningTask = Effect.fnUntraced(function* (threadId: string, runId: string) {
    const seenRuns = new Set<string>();
    let sourceRunId = runId;
    let run: { readonly threadId: string; readonly delegatedTaskId: string | null } | undefined;
    while (!seenRuns.has(sourceRunId)) {
      seenRuns.add(sourceRunId);
      const rows = yield* sql<{
        readonly threadId: string;
        readonly delegatedTaskId: string | null;
        readonly restartOf: string | null;
      }>`SELECT thread_id AS threadId,
          json_extract(payload_json, '$.delegatedTaskId') AS delegatedTaskId,
          json_extract(payload_json, '$.restartContinuationOfRunId') AS restartOf
        FROM orchestration_v2_projection_runs WHERE run_id = ${sourceRunId} LIMIT 1`;
      run = rows[0];
      const restartOf = rows[0]?.restartOf;
      if (run?.threadId !== threadId || run.delegatedTaskId || !restartOf) break;
      sourceRunId = restartOf;
    }
    if (run?.threadId === threadId && run.delegatedTaskId) {
      const named = (yield* subagentById(run.delegatedTaskId))[0];
      if (named?.childThreadId === threadId) return named;
    }
    const forks = yield* sql<{ readonly nodeId: string | null }>`
      SELECT CASE WHEN json_extract(payload_json, '$.forkedFrom.type') = 'node'
        THEN json_extract(payload_json, '$.forkedFrom.nodeId') ELSE NULL END AS nodeId
      FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} LIMIT 1`;
    const nodeId = forks[0]?.nodeId;
    const forked =
      nodeId === null || nodeId === undefined ? undefined : (yield* subagentById(nodeId))[0];
    if (forked?.childThreadId !== threadId) return null;
    if (run?.threadId !== threadId) return forked;
    const first = yield* sql<{ readonly runId: string }>`
      SELECT run_id AS runId FROM orchestration_v2_projection_runs
      WHERE thread_id = ${threadId} ORDER BY ordinal ASC LIMIT 1`;
    return first[0]?.runId === sourceRunId ? forked : null;
  });

  const recordSkillInvocation = Effect.fn("ProjectionStoreV2.recordSkillInvocation")(function* (
    invocation: SkillInvocation,
  ) {
    // Subagent run ids move when a child is resumed. Credits are written once,
    // from rows already committed, so a later resume cannot move this observation.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const payloadJson = yield* encodeSkillInvocation(invocation);
        const inserted = yield* sql<{ readonly invocation_id: string }>`
          INSERT INTO orchestration_v2_skill_invocations
            (invocation_id, thread_id, run_id, skill_key, source, payload_json)
          VALUES (
            ${invocation.id},
            ${invocation.threadId},
            ${invocation.runId},
            ${invocation.skill.key},
            ${invocation.source},
            ${payloadJson}
          )
          ON CONFLICT(invocation_id) DO NOTHING
          RETURNING invocation_id`;
        if (inserted.length === 0) return;
        let threadId: string = invocation.threadId;
        let runId: string = invocation.runId;
        let task = yield* owningTask(threadId, runId);
        const origin = invocation.nativeAncestry?.length
          ? "provider_native"
          : asOrigin(task?.origin);
        const credits: Array<SkillCredit> = [
          { threadId, runId, providerTurnId: invocation.providerTurnId, role: "self", origin },
        ];
        const seen = new Set<string>([`${threadId}\0${runId}`]);
        for (const ancestor of invocation.nativeAncestry ?? []) {
          const key = `${ancestor.threadId}\0${ancestor.runId}`;
          if (seen.has(key)) break;
          seen.add(key);
          credits.push({
            threadId: ancestor.threadId,
            runId: ancestor.runId,
            providerTurnId: ancestor.providerTurnId,
            role: "descendant",
            origin,
          });
          threadId = ancestor.threadId;
          runId = ancestor.runId;
        }
        if (invocation.nativeAncestry?.length) task = yield* owningTask(threadId, runId);
        while (task !== null) {
          // A native task's mutable runId may already name a later parent turn.
          const parentRun = task.origin === "provider_native" ? runId : task.runId;
          if (parentRun === null) break;
          const key = `${task.threadId}\0${parentRun}`;
          if (task.threadId === threadId || seen.has(key)) break;
          seen.add(key);
          credits.push({
            threadId: task.threadId,
            runId: parentRun,
            providerTurnId: null,
            role: "descendant",
            origin,
          });
          threadId = task.threadId;
          runId = parentRun;
          task = yield* owningTask(threadId, runId);
        }
        for (const credit of credits) {
          yield* sql`INSERT INTO orchestration_v2_skill_invocation_credits
            (invocation_id, scope_thread_id, scope_run_id, scope_provider_turn_id, role, origin)
            VALUES (
              ${invocation.id},
              ${credit.threadId},
              ${credit.runId},
              ${credit.providerTurnId},
              ${credit.role},
              ${credit.origin}
            )`;
        }
      }),
    );
  });

  const matchedRows = (input: GetSkillStatisticsInput) => {
    const inclusive = inclusiveOf(input);
    return sql`SELECT i.invocation_id, i.thread_id AS executor_thread_id, i.run_id AS binding_run_id,
        i.source, i.skill_key, i.sequence, i.payload_json, c.scope_thread_id, c.scope_run_id, c.scope_provider_turn_id, c.role, c.origin
      FROM orchestration_v2_skill_invocations i
      JOIN orchestration_v2_skill_invocation_credits c ON c.invocation_id = i.invocation_id
      JOIN orchestration_v2_projection_runs binding
        ON binding.run_id = i.run_id AND binding.status <> 'rolled_back'
      JOIN orchestration_v2_projection_threads binding_thread
        ON binding_thread.thread_id = binding.thread_id AND binding_thread.deleted_at IS NULL
      JOIN orchestration_v2_projection_threads executor_thread
        ON executor_thread.thread_id = i.thread_id AND executor_thread.deleted_at IS NULL
      JOIN orchestration_v2_projection_runs scope_run
        ON scope_run.run_id = c.scope_run_id AND scope_run.status <> 'rolled_back'
      JOIN orchestration_v2_projection_threads scope_thread
        ON scope_thread.thread_id = c.scope_thread_id AND scope_thread.deleted_at IS NULL
      WHERE ${inclusive ? sql`c.role IN ('self', 'descendant')` : sql`c.role = 'self'`}
      ${input.threadId === undefined ? sql`` : sql`AND c.scope_thread_id = ${input.threadId}`}
      ${input.providerTurnId === undefined ? sql`` : sql`AND c.scope_provider_turn_id = ${input.providerTurnId}`}
      ${
        input.runId === undefined
          ? sql``
          : inclusive || input.threadId !== undefined
            ? sql`AND c.scope_run_id = ${input.runId}`
            : sql`AND c.scope_run_id = ${input.runId}
                AND c.scope_thread_id = (
                  SELECT thread_id FROM orchestration_v2_projection_runs WHERE run_id = ${input.runId}
                )`
      }`;
  };
  const deduped = (input: GetSkillStatisticsInput) => sql`
    SELECT invocation_id,
      MAX(executor_thread_id) AS executor_thread_id,
      MAX(binding_run_id) AS binding_run_id,
      MAX(source) AS source,
      MAX(skill_key) AS skill_key,
      MAX(sequence) AS sequence,
      MAX(payload_json) AS payload_json,
      MAX(origin) AS origin
    FROM (${matchedRows(input)}) matched
    GROUP BY invocation_id`;
  const roleOf = (input: GetSkillStatisticsInput) =>
    input.threadId !== undefined
      ? sql`CASE WHEN executor_thread_id = ${input.threadId} THEN 'self' ELSE 'descendant' END`
      : input.runId !== undefined
        ? sql`CASE WHEN executor_thread_id = (
            SELECT thread_id FROM orchestration_v2_projection_runs WHERE run_id = ${input.runId}
          ) THEN 'self' ELSE 'descendant' END`
        : input.providerTurnId !== undefined
          ? sql`CASE WHEN executor_thread_id = (
              SELECT thread_id FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id = ${input.providerTurnId}
            ) THEN 'self' ELSE 'descendant' END`
          : sql`'self'`;

  const getSkillStatistics = Effect.fn("ProjectionStoreV2.getSkillStatistics")(function* (
    input: GetSkillStatisticsInput,
  ): Effect.fn.Return<SkillStatistics, SkillStatisticsReadError> {
    const scope = input.scope ?? "own";
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const observations = yield* sql<Counts>`
            SELECT COUNT(*) AS total,
              COALESCE(SUM(source = 'user_requested'), 0) AS userRequested,
              COALESCE(SUM(source = 'agent_observed'), 0) AS agentObserved
            FROM (${deduped(input)}) observations`;
          const skillRows = yield* sql<Counts & { skill: string }>`
            SELECT json_extract(MAX(payload_json), '$.skill') AS skill,
              COUNT(*) AS total,
              COALESCE(SUM(source = 'user_requested'), 0) AS userRequested,
              COALESCE(SUM(source = 'agent_observed'), 0) AS agentObserved
            FROM (${deduped(input)}) observations
            GROUP BY skill_key ORDER BY skill_key`;
          const creditRows = yield* sql<
            Counts & { threadId: ThreadId; runId: RunId }
          >`SELECT scope_thread_id AS threadId, scope_run_id AS runId,
              COUNT(DISTINCT invocation_id) AS total,
              COUNT(DISTINCT CASE WHEN source = 'user_requested' THEN invocation_id END) AS userRequested,
              COUNT(DISTINCT CASE WHEN source = 'agent_observed' THEN invocation_id END) AS agentObserved
            FROM (${matchedRows(input)}) matched
            GROUP BY scope_thread_id, scope_run_id`;
          const threadCreditRows = yield* sql<Counts & { threadId: ThreadId }>`
            SELECT scope_thread_id AS threadId,
              COUNT(DISTINCT invocation_id) AS total,
              COUNT(DISTINCT CASE WHEN source = 'user_requested' THEN invocation_id END) AS userRequested,
              COUNT(DISTINCT CASE WHEN source = 'agent_observed' THEN invocation_id END) AS agentObserved
            FROM (${matchedRows(input)}) matched
            GROUP BY scope_thread_id`;
          const executorRows = yield* sql<
            Counts & { threadId: ThreadId; runId: RunId; role: CreditRole; origin: string }
          >`SELECT executor_thread_id AS threadId, binding_run_id AS runId,
              ${roleOf(input)} AS role, origin,
              COUNT(*) AS total,
              COALESCE(SUM(source = 'user_requested'), 0) AS userRequested,
              COALESCE(SUM(source = 'agent_observed'), 0) AS agentObserved
            FROM (${deduped(input)}) observations
            GROUP BY executor_thread_id, binding_run_id, role, origin
            ORDER BY executor_thread_id, binding_run_id, role`;
          const runRows = yield* sql<{ threadId: ThreadId; runId: RunId }>`
            SELECT r.thread_id AS threadId, r.run_id AS runId
            FROM orchestration_v2_projection_runs r
            JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
            WHERE t.deleted_at IS NULL AND r.status <> 'rolled_back'
            ${input.threadId === undefined ? sql`` : sql`AND r.thread_id = ${input.threadId}`}
            ${input.runId === undefined ? sql`` : sql`AND r.run_id = ${input.runId}`}
            ORDER BY r.thread_id, r.ordinal`;
          const nativeTurns = yield* sql<
            Counts & {
              threadId: ThreadId;
              providerTurnId: ProviderTurnId;
              bindingRunId: RunId;
              active: number;
            }
          >`SELECT p.thread_id AS threadId, p.provider_turn_id AS providerTurnId,
              p.binding_run_id AS bindingRunId, p.status IN ('pending', 'running') AS active,
              COUNT(DISTINCT m.invocation_id) AS total,
              COUNT(DISTINCT CASE WHEN m.source = 'user_requested' THEN m.invocation_id END) AS userRequested,
              COUNT(DISTINCT CASE WHEN m.source = 'agent_observed' THEN m.invocation_id END) AS agentObserved
            FROM orchestration_v2_projection_provider_turns p
            JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id AND t.deleted_at IS NULL
            JOIN orchestration_v2_projection_runs r ON r.run_id = p.binding_run_id AND r.status <> 'rolled_back'
            JOIN orchestration_v2_projection_threads owner ON owner.thread_id = r.thread_id AND owner.deleted_at IS NULL
            LEFT JOIN (${matchedRows(input)}) m
              ON m.scope_provider_turn_id = p.provider_turn_id AND m.scope_thread_id = p.thread_id
            WHERE p.run_attempt_id IS NULL
              ${input.threadId === undefined ? sql`` : sql`AND p.thread_id = ${input.threadId}`}
              ${input.runId === undefined ? sql`` : sql`AND p.binding_run_id = ${input.runId}`}
            GROUP BY p.provider_turn_id
            ORDER BY p.thread_id, p.started_at, p.ordinal, p.provider_turn_id`;
          const threadRows = yield* sql<{
            threadId: ThreadId;
            latestRunId: RunId | null;
            activeRunIds: string;
          }>`
            SELECT t.thread_id AS threadId,
              (SELECT r.run_id FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id
                AND r.status <> 'rolled_back' ORDER BY r.ordinal DESC LIMIT 1) AS latestRunId,
              (SELECT json_group_array(r.run_id) FROM orchestration_v2_projection_runs r
                WHERE r.thread_id = t.thread_id
                AND r.status IN ('preparing', 'running', 'waiting', 'interrupting')) AS activeRunIds
            FROM orchestration_v2_projection_threads t WHERE t.deleted_at IS NULL
            ${input.threadId === undefined ? sql`` : sql`AND t.thread_id = ${input.threadId}`}
            ${
              input.providerTurnId === undefined
                ? sql``
                : sql`AND EXISTS (
              SELECT 1 FROM orchestration_v2_projection_provider_turns p
              WHERE p.thread_id = t.thread_id AND p.provider_turn_id = ${input.providerTurnId})`
            }
            ${
              input.runId === undefined
                ? sql``
                : sql`AND (EXISTS (
                    SELECT 1 FROM orchestration_v2_projection_runs r
                    WHERE r.thread_id = t.thread_id AND r.run_id = ${input.runId}
                      AND r.status <> 'rolled_back'
                  ) ${
                    input.threadId === undefined
                      ? sql``
                      : sql`OR EXISTS (
                    SELECT 1 FROM orchestration_v2_projection_provider_turns p
                    JOIN orchestration_v2_projection_runs r ON r.run_id = p.binding_run_id AND r.status <> 'rolled_back'
                    WHERE p.thread_id = t.thread_id AND p.binding_run_id = ${input.runId}
                  )`
                  })`
            }
            ORDER BY t.thread_id`;
          const byThread = new Map(threadCreditRows.map((row) => [row.threadId, row]));
          const nativeByThread = new Map<ThreadId, Array<(typeof nativeTurns)[number]>>();
          for (const turn of nativeTurns) {
            const turns = nativeByThread.get(turn.threadId) ?? [];
            turns.push(turn);
            nativeByThread.set(turn.threadId, turns);
          }
          const byRun = new Map(creditRows.map((row) => [`${row.threadId}\0${row.runId}`, row]));
          const runs = runRows.map((run) => ({
            threadId: run.threadId,
            runId: run.runId,
            ...(byRun.get(`${run.threadId}\0${run.runId}`) ?? emptyCounts()),
          }));
          return {
            scope,
            ...(observations[0] ?? emptyCounts()),
            nativeTurns: nativeTurns
              .filter(
                (turn) =>
                  input.providerTurnId === undefined ||
                  turn.providerTurnId === input.providerTurnId,
              )
              .map((turn) => ({ ...turn, active: Boolean(turn.active) })),
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
            executors: executorRows.map((row) => ({
              threadId: row.threadId,
              runId: row.runId,
              role: row.role,
              origin: asOrigin(row.origin),
              total: row.total,
              userRequested: row.userRequested,
              agentObserved: row.agentObserved,
            })),
            runs,
            threads: yield* Effect.forEach(threadRows, (row) =>
              Effect.gen(function* () {
                const total = byThread.get(row.threadId) ?? emptyCounts();
                const native = nativeByThread.get(row.threadId) ?? [];
                const latestNative = native.at(-1);
                const latest =
                  row.latestRunId === null
                    ? emptyCounts()
                    : (byRun.get(`${row.threadId}\0${row.latestRunId}`) ?? emptyCounts());
                return {
                  threadId: row.threadId,
                  ...total,
                  latestRunId: row.latestRunId,
                  latestRunCount: latest.total,
                  beforeLatestRunCount: total.total - latest.total,
                  activeRunIds: yield* decodeRunIds(row.activeRunIds),
                  latestNativeTurnId: latestNative?.providerTurnId ?? null,
                  latestNativeTurnCount: latestNative?.total ?? 0,
                  beforeLatestNativeTurnCount:
                    native.reduce((sum, turn) => sum + turn.total, 0) - (latestNative?.total ?? 0),
                  activeNativeTurnIds: native
                    .filter((turn) => turn.active)
                    .map((turn) => turn.providerTurnId),
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
        SELECT sequence, payload_json FROM (${deduped(input)}) observations
        WHERE sequence > ${input.after ?? 0}
        ORDER BY sequence LIMIT ${limit + 1}`;
      return {
        invocations: yield* Effect.forEach(rows.slice(0, limit), (row) =>
          decodeInvocation(row.payload_json),
        ),
        nextCursor: rows.length > limit ? rows[limit - 1]!.sequence : null,
      };
    }).pipe(Effect.mapError((cause) => new SkillStatisticsReadError({ cause })));
  });
  return { getSkillStatistics, getSkillInvocations, recordSkillInvocation };
});
