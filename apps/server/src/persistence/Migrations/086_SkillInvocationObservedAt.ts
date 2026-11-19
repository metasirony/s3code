import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX orchestration_v2_skill_invocations_observed_at
    ON orchestration_v2_skill_invocations(unixepoch(json_extract(payload_json, '$.observedAt'), 'subsec'))`;
});
