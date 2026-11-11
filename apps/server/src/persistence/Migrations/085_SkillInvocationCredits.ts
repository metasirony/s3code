import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // One observation is stored once. These rows snapshot who it counted for at
  // that moment; later subagent resumes must not rewrite them.
  yield* sql`CREATE TABLE orchestration_v2_skill_invocation_credits (
    invocation_id TEXT NOT NULL,
    scope_thread_id TEXT NOT NULL,
    scope_run_id TEXT NOT NULL,
    scope_provider_turn_id TEXT,
    role TEXT NOT NULL,
    origin TEXT NOT NULL,
    PRIMARY KEY (invocation_id, scope_thread_id, scope_run_id)
  )`;
  yield* sql`CREATE INDEX orchestration_v2_skill_invocation_credits_scope
    ON orchestration_v2_skill_invocation_credits(scope_thread_id, scope_run_id, role)`;
  yield* sql`ALTER TABLE orchestration_v2_projection_provider_turns ADD COLUMN binding_run_id TEXT`;
  yield* sql`INSERT INTO orchestration_v2_skill_invocation_credits
      (invocation_id, scope_thread_id, scope_run_id, scope_provider_turn_id, role, origin)
    SELECT invocation_id, thread_id, run_id, json_extract(payload_json, '$.providerTurnId'), 'self', 'root'
    FROM orchestration_v2_skill_invocations
    WHERE NOT EXISTS (
      SELECT 1 FROM orchestration_v2_skill_invocation_credits c
      WHERE c.invocation_id = orchestration_v2_skill_invocations.invocation_id
    )`;
});
