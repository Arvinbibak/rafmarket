// Vercel Express framework entrypoint for the isolated Mainnet API.
import express from "express";
import app from "./artifacts/api-server/src/app.ts";

// Keep the explicit Express import so Vercel detects the framework.
// The app factory is separate from the local PORT-based server.
void express;
export default app;
