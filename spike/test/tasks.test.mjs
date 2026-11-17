import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../app/tasks.mjs";

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

test("checkpoints append and invalid updates are rejected", () => {
  const { dir, store } = tempStore();
  try {
    const task = store.create({ title: "长任务", dueAt: new Date().toISOString() });
    store.addCheckpoint(task.id, "完成第一步", "@human");
    assert.equal(store.get(task.id).checkpoints.length, 1);
    assert.throws(() => store.update(task.id, { status: "nope" }), /bad status/);
    assert.throws(() => store.update(task.id, { dueAt: "not-a-date" }), /bad dueAt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
