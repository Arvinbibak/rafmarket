// Dedicated Vercel Express entrypoint for the Mainnet API.
import express from "express";
import app from "./dist/app.mjs";

// Keep Express explicit so Vercel detects the framework.
void express;
export default app;
