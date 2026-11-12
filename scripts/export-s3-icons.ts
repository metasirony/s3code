#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import sharp from "sharp";

import { BRAND_ASSET_PATHS, resolveWebIconOverrides } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

class S3IconRenderError extends Schema.TaggedError<S3IconRenderError>()("S3IconRenderError", {
  size: Schema.Number,
  cause: Schema.Defect(),
}) {}

class S3IconStaleError extends Schema.TaggedError<S3IconStaleError>()("S3IconStaleError", {
  path: Schema.String,
}) {}

const exportS3Icons = Effect.fn("exportS3Icons")(function* (check: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const source = Buffer.from(
    (yield* fs.readFileString(path.join(root, "assets/s3code/s3-logo-blue.svg"))).replaceAll(
      "\r\n",
      "\n",
    ),
  );
  const rendered = new Map<number, Buffer>();
  for (const size of new Set([...WINDOWS_ICON_SIZES, 180, 192, 512, 1024])) {
    rendered.set(
      size,
      yield* Effect.tryPromise({
        try: () => sharp(source, { density: 768 }).resize(size, size).png().toBuffer(),
        catch: (cause) => new S3IconRenderError({ size, cause }),
      }),
    );
  }
  const ico = encodePngIco(
    WINDOWS_ICON_SIZES.map((size) => ({
      size,
      contents: rendered.get(size)!,
    })),
  );
  const webAssets = new Map([
    ["favicon.ico", ico],
    ["favicon-16x16.png", rendered.get(16)!],
    ["favicon-32x32.png", rendered.get(32)!],
    ["apple-touch-icon.png", rendered.get(180)!],
    ["icon-192x192.png", rendered.get(192)!],
    ["icon-512x512.png", rendered.get(512)!],
  ]);
  const outputs = new Map<string, Uint8Array>([
    ["favicon.svg", source],
    [BRAND_ASSET_PATHS.developmentWindowsIconIco, ico],
    [BRAND_ASSET_PATHS.nightlyWindowsIconIco, ico],
    [BRAND_ASSET_PATHS.productionWindowsIconIco, ico],
    [BRAND_ASSET_PATHS.developmentUniversalIconPng, rendered.get(1024)!],
    [BRAND_ASSET_PATHS.nightlyLinuxIconPng, rendered.get(1024)!],
    [BRAND_ASSET_PATHS.productionLinuxIconPng, rendered.get(1024)!],
  ]);
  for (const brand of ["development", "nightly", "production"] as const) {
    for (const icon of resolveWebIconOverrides(brand, "apps/web/public")) {
      const contents = webAssets.get(path.basename(icon.targetRelativePath))!;
      outputs.set(icon.sourceRelativePath, contents);
      outputs.set(icon.targetRelativePath, contents);
    }
  }
  for (const [relativePath, contents] of outputs) {
    const target = path.join(root, relativePath);
    if (check) {
      const actual = yield* fs.readFile(target);
      if (!Buffer.from(actual).equals(contents)) {
        return yield* new S3IconStaleError({ path: relativePath });
      }
    } else {
      yield* fs.writeFile(target, contents);
    }
  }
  yield* Console.log(`${check ? "Verified" : "Exported"} ${outputs.size} S3 Windows/web assets.`);
});

const command = Command.make(
  "export-s3-icons",
  {
    check: Flag.Boolean("check").pipe(Flag.withDefault(false)),
  },
  ({ check }) => exportS3Icons(check),
);

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
