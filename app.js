// Vercel Express framework entrypoint for the isolated Mainnet API.
// Keep the app factory separate from the local PORT-based server in artifacts/api-server/src/index.ts.
export { default } from "./artifacts/api-server/src/app.ts";
