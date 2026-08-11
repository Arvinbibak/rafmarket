import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");
const dbDir = path.resolve(workspaceRoot, "lib/db");
const dbDistDir = path.resolve(dbDir, "dist");

const distDir = path.resolve(artifactDir, "dist");

async function buildAll() {
  // Clean previous API build
  await rm(distDir, {
    recursive: true,
    force: true,
  });

  // Build the workspace database package first.
  // This guarantees that @workspace/db resolves to compiled
  // JavaScript instead of src/index.ts in the Vercel environment.
  await esbuild({
    entryPoints: [
      path.resolve(dbDir, "src/index.ts"),
    ],

    platform: "node",

    bundle: false,

    format: "esm",

    outdir: dbDistDir,

    outExtension: {
      ".js": ".js",
    },

    sourcemap: "linked",

    logLevel: "info",

    packages: "external",

    absWorkingDir: workspaceRoot,
  });

  // Build the API server.
  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
    ],

    platform: "node",

    bundle: true,

    format: "esm",

    outdir: distDir,

    outExtension: {
      ".js": ".mjs",
    },

    sourcemap: "linked",

    logLevel: "info",

    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],

    plugins: [
      esbuildPluginPino({
        transports: ["pino-pretty"],
      }),
    ],

    banner: {
      js: `
import { createRequire as __bannerCrReq } from "node:module";
import __bannerPath from "node:path";
import __bannerUrl from "node:url";

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },

    absWorkingDir: workspaceRoot,

    // Force esbuild to resolve the compiled workspace database package.
    alias: {
      "@workspace/db": path.resolve(dbDistDir, "index.js"),
      "@workspace/db/schema": path.resolve(dbDistDir, "schema/index.js"),
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});