import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore, nextCronAfter } from "../../app/tasks.mjs";

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "agentim-tasks-"));
  return { dir, path: join(dir, "tasks.json"), store: new TaskStore(join(dir, "tasks.json")) };
}

test("task ledger persists tasks across reloads", () => {
  const { dir, path, store } = tempStore();
  try {
    const task = store.create({ title: "月度对账", owner: "@a:localhost", roomId: "!r" });
    assert.equal(store.list().length, 1);
    assert.equal(store.get(task.id).title, "月度对账");
    const reloaded = new TaskStore(path);
    assert.equal(reloaded.get(task.id).owner, "@a:localhost");
    assert.equal(reloaded.get(task.id).status, "pending");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("due tasks dispatch once and become active", () => {
  const { dir, store } = tempStore();
  try {
    const past = store.create({ title: "到期", dueAt: new Date(Date.now() - 1000).toISOString() });
    store.create({ title: "未来", dueAt: new Date(Date.now() + 60_000).toISOString() });
    assert.deepEqual(
      store.due().map((t) => t.id),
      [past.id],
    );
    store.dispatch(past.id);
    assert.equal(store.get(past.id).status, "active");
    assert.equal(store.due().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recurring tasks schedule the next run after dispatch", () => {
  const { dir, store } = tempStore();
  try {
    const task = store.create({
      title: "巡检",
      dueAt: new Date(Date.now() - 1000).toISOString(),
      intervalMinutes: 30,
    });
    store.dispatch(task.id);
    const next = store.get(task.id);
    assert.equal(next.status, "pending");
    assert.ok(Date.parse(next.dueAt) > Date.now());
    assert.equal(store.due().length, 0);
    assert.match(next.checkpoints.at(-1).text, /next/);
    assert.throws(() => store.update(task.id, { intervalMinutes: -1 }), /bad intervalMinutes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cron computes the next local minute and dispatches to the next run", () => {
  const from = new Date(2026, 10, 18, 8, 0, 0); // local time
  const next = new Date(nextCronAfter("0 9 * * 1-5", from.getTime()));
  assert.equal(next.getDate(), 18);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);

  const { dir, store } = tempStore();
  try {
    const task = store.create({ title: "早报", cron: "0 9 * * 1-5" });
    assert.equal(task.cron, "0 9 * * 1-5");
    assert.ok(task.dueAt);
    store.dispatch(task.id);
    assert.ok(Date.parse(store.get(task.id).dueAt) > Date.now());
    assert.throws(() => store.create({ title: "bad", intervalMinutes: 5, cron: "* * * * *" }), /not both/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed tasks retry with backoff then escalate", () => {
  const { dir, store } = tempStore();
  try {
    const task = store.create({
      title: "重试任务",
      dueAt: new Date(Date.now() - 1000).toISOString(),
      maxRetries: 2,
      retryBackoffMinutes: 1,
    });
    store.dispatch(task.id);
    store.scheduleRetry(task.id, "boom");
    let current = store.get(task.id);
    assert.equal(current.status, "pending");
    assert.equal(current.retryCount, 1);
    assert.ok(Date.parse(current.dueAt) > Date.now());
    store.scheduleRetry(task.id, "boom again");
    current = store.get(task.id);
    assert.equal(current.retryCount, 2);
    store.scheduleRetry(task.id, "last failure");
    current = store.get(task.id);
    assert.equal(current.status, "failed");
    assert.equal(current.needsAttention, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markStale flags active tasks after a restart threshold", () => {
  const { dir, store } = tempStore();
  try {
    const task = store.create({ title: "长任务", dueAt: new Date().toISOString() });
    store.dispatch(task.id);
    assert.equal(store.markStale(Date.now()), 0);
    assert.equal(store.markStale(Date.now() + 31 * 60_000), 1);
    assert.equal(store.get(task.id).needsAttention, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkpoints append and invalid updates are rejected", () => {
  const { dir, store } = tempStore();
  try {
    const task = store.create({ title: "长任务", dueAt: new Date().toISOString() });
    store.addCheckpoint(task.id, "完成第一步", "@human");
    assert.equal(store.get(task.id).checkpoints.length, 1);
    store.update(task.id, { status: "failed" });
    assert.equal(store.get(task.id).status, "failed");
    assert.throws(() => store.update(task.id, { status: "nope" }), /bad status/);
    assert.throws(() => store.update(task.id, { dueAt: "not-a-date" }), /bad dueAt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
