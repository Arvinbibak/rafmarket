// Dedicated Vercel Express entrypoint for the Mainnet API project.
import express from "express";
import app from "./src/app.ts";

// Keep Express explicit so Vercel detects the framework.
void express;
export default app;
