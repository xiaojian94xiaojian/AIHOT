import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBoardsInWorker } from "../backend/method/compute.ts";
import type { BoardInput } from "../backend/method/consensus.ts";

test("worker computation errors reject the round", async () => {
  await assert.rejects(computeBoardsInWorker([{} as BoardInput]));
});

test("a round exceeding its explicit worker deadline terminates instead of occupying the queue indefinitely", async () => {
  await assert.rejects(computeBoardsInWorker([{} as BoardInput], { timeoutMs: 1 }), /timed out|deadline/i);
});
