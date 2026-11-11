import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE orchestration_v2_skill_invocations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    invocation_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    skill_key TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX orchestration_v2_skill_invocations_thread_run
    ON orchestration_v2_skill_invocations(thread_id, run_id)`;
  yield* sql`CREATE INDEX orchestration_v2_skill_invocations_skill
    ON orchestration_v2_skill_invocations(skill_key)`;
});
