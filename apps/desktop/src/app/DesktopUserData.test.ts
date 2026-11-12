import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each([false, true])(
  "uses an isolated profile without importing official app data (development=%s)",
  (isDevelopment) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "s3code-profile-" });
      const state = '{"os_crypt":{"encrypted_key":"official-test-key"}}';
      for (const name of [
        "t3code",
        "t3code-v2",
        "t3code-dev",
        "T3 Code (Alpha)",
        "T3 Code (Dev)",
      ]) {
        yield* fs.makeDirectory(path.join(directory, name), { recursive: true });
        yield* fs.writeFileString(path.join(directory, name, "Local State"), state);
      }
      const destination = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment,
        platform: "win32",
      });
      assert.equal(destination, path.join(directory, isDevelopment ? "s3code-dev" : "s3code"));
      assert.isFalse(yield* fs.exists(path.join(destination, "Local State")));
      assert.equal(
        yield* fs.readFileString(path.join(directory, "t3code-v2", "Local State")),
        state,
      );
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing fork state");
      yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment, platform: "win32" });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing fork state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
