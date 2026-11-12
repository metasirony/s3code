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
import { BRAND_MARK_PATH } from "@t3tools/shared/brand";

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
  const approvedPaths = [...source.toString().matchAll(/<path d="([^"]+)" fill="white"\s*\/>/g)]
    .map((match) => match[1])
    .join(" ");
  if (approvedPaths !== BRAND_MARK_PATH) {
    return yield* new S3IconStaleError({ path: "packages/shared/src/brand.ts" });
  }
  const black = yield* fs.readFile(path.join(root, "assets/s3code/s3-logo-black.svg"));
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="${BRAND_MARK_PATH}" fill="white"/></svg>\n`;
  const sky = yield* fs.readFileString(
    path.join(root, "assets/nightly/app-icon.icon/Assets/background.svg"),
  );
  const clouds: string[] = [];
  for (const cloud of [
    { file: "cloud-lower-left.svg", scale: 25, x: -309.6375, y: 268.66077693836917 },
    { file: "cloud-upper-right.svg", scale: 15, x: 387.9605131881942, y: -134.30064713259117 },
  ]) {
    const svg = yield* fs.readFileString(
      path.join(root, "assets/nightly/app-icon.icon/Assets", cloud.file),
    );
    const inner = svg
      .replace(/<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/ filter="url\(#soft\)"/g, "")
      .replaceAll('id="', `id="${cloud.file}-`)
      .replaceAll("url(#", `url(#${cloud.file}-`);
    clouds.push(
      `<g transform="translate(${64 + cloud.x / 8} ${64 + cloud.y / 8}) scale(${cloud.scale / 8}) translate(-32 -16)">${inner}</g>`,
    );
  }
  const nightly = Buffer.from(
    sky
      .replace(
        /<\/svg>\s*$/,
        `<g clip-path="url(#frame)">${clouds.join("")}</g><path d="${BRAND_MARK_PATH}" fill="white"/></svg>\n`,
      )
      .replaceAll("\r\n", "\n"),
  );
  const outputs = new Map<string, Uint8Array>([
    ["favicon.svg", source],
    ["assets/prod/logo.svg", black],
    ["assets/s3code/s3-logo-nightly.svg", nightly],
  ]);
  for (const variant of ["dev", "nightly", "prod"]) {
    outputs.set(`assets/${variant}/app-icon.icon/Assets/text.svg`, Buffer.from(mark));
  }
  const widget = mark.replace(
    'width="128" height="128" viewBox="0 0 128 128"',
    'width="111" height="74" viewBox="7 29 111 74"',
  );
  outputs.set("apps/mobile/assets/widget/T3Mark.svg", Buffer.from(widget));
  for (const [brand, artwork, universal, windows] of [
    [
      "development",
      source,
      BRAND_ASSET_PATHS.developmentUniversalIconPng,
      BRAND_ASSET_PATHS.developmentWindowsIconIco,
    ],
    [
      "nightly",
      nightly,
      BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    ],
    [
      "production",
      black,
      BRAND_ASSET_PATHS.productionLinuxIconPng,
      BRAND_ASSET_PATHS.productionWindowsIconIco,
    ],
  ] as const) {
    const rendered = new Map<number, Buffer>();
    for (const size of new Set([...WINDOWS_ICON_SIZES, 180, 192, 512, 1024])) {
      rendered.set(
        size,
        yield* Effect.tryPromise({
          try: () => sharp(artwork, { density: 768 }).resize(size, size).png().toBuffer(),
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
    outputs.set(windows, ico);
    outputs.set(universal, rendered.get(1024)!);
    if (brand !== "development") {
      const filename = brand === "nightly" ? "icon-nightly.webp" : "icon.webp";
      outputs.set(
        `apps/marketing/src/assets/${filename}`,
        yield* Effect.tryPromise({
          try: () =>
            sharp(artwork, { density: 768 }).resize(256, 256).webp({ lossless: true }).toBuffer(),
          catch: (cause) => new S3IconRenderError({ size: 256, cause }),
        }),
      );
    }
    for (const icon of resolveWebIconOverrides(brand, "apps/web/public")) {
      const contents = webAssets.get(path.basename(icon.targetRelativePath))!;
      outputs.set(icon.sourceRelativePath, contents);
      if (brand === "development") outputs.set(icon.targetRelativePath, contents);
      if (brand === "production" && !path.basename(icon.targetRelativePath).startsWith("icon-")) {
        outputs.set(`apps/marketing/public/${path.basename(icon.targetRelativePath)}`, contents);
      }
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
  yield* Console.log(
    `${check ? "Verified" : "Exported"} ${outputs.size} S3 assets (Apple native PNG exports require Icon Composer).`,
  );
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
