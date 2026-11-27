import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");
const dbDir = path.resolve(workspaceRoot, "lib/db");
const dbDistDir = path.resolve(dbDir, "dist");
const apiDistDir = path.resolve(artifactDir, "dist");

async function buildDatabase() {
  console.log("Building @workspace/db");
  await rm(dbDistDir, { recursive: true, force: true });
  await rm(path.resolve(dbDir, "tsconfig.tsbuildinfo"), { force: true });
  await execFileAsync("pnpm", ["--dir", dbDir, "exec", "tsc", "-p", "tsconfig.json"], {
    cwd: workspaceRoot,
    env: { ...process.env, NODE_ENV: "production" },
  });
  console.log("Database package compiled successfully.");
}

async function buildApi() {
  console.log("Building @workspace/api-server");
  await rm(apiDistDir, { recursive: true, force: true });
  const dbEntry = path.resolve(dbDistDir, "index.js");

  // Build both the local PORT-based server and the Express app export.
  // Vercel imports app.mjs as a serverless handler and must not run listen().
  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/app.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: apiDistDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
    logLevel: "info",
    alias: {
      "@workspace/db": dbEntry,
      "@workspace/db/schema": path.resolve(dbDistDir, "schema/index.js"),
    },
    external: [
      "*.node", "sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt",
      "argon2", "fsevents", "re2", "farmhash", "xxhash-addon", "bufferutil",
      "utf-8-validate", "ssh2", "cpu-features", "dtrace-provider", "isolated-vm",
      "lightningcss", "pg-native", "oracledb", "mongodb-client-encryption",
      "nodemailer", "handlebars", "knex", "typeorm", "protobufjs", "onnxruntime-node",
      "@tensorflow/*", "@prisma/client", "@mikro-orm/*", "@grpc/*", "@swc/*",
      "@aws-sdk/*", "@azure/*", "@opentelemetry/*", "@google-cloud/*", "@google/*",
      "googleapis", "firebase-admin", "@parcel/watcher", "@sentry/profiling-node",
      "@tree-sitter/*", "aws-sdk", "classic-level", "dd-trace", "ffi-napi", "grpc",
      "hiredis", "kerberos", "leveldown", "miniflare", "mysql2", "newrelic", "odbc",
      "piscina", "realm", "ref-napi", "rocksdb", "sass-embedded", "sequelize",
      "serialport", "snappy", "tinypool", "usb", "workerd", "wrangler", "zeromq",
      "zeromq-prebuilt", "playwright", "puppeteer", "puppeteer-core", "electron",
    ],
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
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
  });
  console.log("API bundles completed successfully.");
}

async function buildAll() {
  await buildDatabase();
  await buildApi();
  console.log("BUILD FINISHED");
}

buildAll().catch((error) => {
  console.error("BUILD FAILED", error);
  process.exit(1);
});
