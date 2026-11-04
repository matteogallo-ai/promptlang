import { afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { SCRATCH } from "./scratch";

// A hook in a preloaded file runs once, after every test file.
afterAll(() => rm(SCRATCH, { recursive: true, force: true }));
