// Repeatable team benchmark runner.
//
// It creates fresh agents (fresh Claude sessions), copies a task fixture into
// a per-arm workspace, sends one human task message, waits for the room to go
// idle, scores the result, then soft-deletes the agents.
//
// Prerequisites: Tuwunel + app server are running (npm start).
//
//   node bench/run.mjs --task money-rounding --arms single,pair --runs 2
//
// Keep runs small: every agent is a real Claude CLI turn.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const dataRoot = join(appRoot, "app", "data", "bench");
const auditPath = join(appRoot, "app", "data", "audit.jsonl");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const taskId = argValue("task", "money-rounding");
const arms = String(argValue("arms", "single,pair"))
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const runs = Math.max(1, Number(argValue("runs", "1")) || 1);
const timeoutSec = Math.max(30, Number(argValue("timeout", "240")) || 240);
const graceSec = Math.max(3, Number(argValue("grace", "12")) || 12);
const server = String(argValue("server", "http://127.0.0.1:8790")).replace(/\/+$/, "");
const keep = hasFlag("keep");

const SHORT = {
  "product-manager": "pm",
  "business-analyst": "ba",
  architect: "arch",
  coder: "coder",
  reviewer: "reviewer",
  qa: "qa",
};
const TASK_ROOT = join(here, "tasks", taskId);

const ARMS = {
  single: {
    roles: ["coder"],
    room: "dm",
    prompt: (workspace) =>
      `你在一个自动化 benchmark 仓库 ${workspace}。任务：npm test 有失败，请修复。只修改 src/money.mjs，不要修改 test/ 或 docs/spec.md；不要猜测试，测试就是契约。完成后运行 npm test，全过后报告。你单独完成，不需要等其他人。`,
  },
  pair: {
    roles: ["coder", "reviewer"],
    room: "group",
    name: "Bench Pair",
    prompt: (workspace) =>
      `这是一个自动化 benchmark 仓库 ${workspace}。任务：npm test 有失败。工程师负责修复，评审者独立复验；只修改 src/money.mjs，不要修改 test/ 或 docs/spec.md。修完运行 npm test，全过后两人各自报告，评审者要给独立证据。人类不会中途介入。`,
  },
  squad: {
    roles: ["product-manager", "business-analyst", "architect", "coder", "reviewer", "qa"],
    room: "group",
    name: "Bench Squad",
    prompt: (workspace) =>
      `这是一个自动化 benchmark 仓库 ${workspace}。任务：npm test 有失败。产品经理/业务分析先明确验收边界，架构师给最小改动方案，工程师实现，评审者独立复验，QA 跑测试。只修改 src/money.mjs，不要改 test/ 或 docs/spec.md。不要为了礼貌空转；完成后各自报告证据。人类不会中途介入。`,
  },
};

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function localTime() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(server + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep null
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return data;
}

function auditLines() {
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function testIn(workspace) {
  try {
    const out = execSync("npm test", {
      cwd: workspace,
      encoding: "utf8",
      timeout: 60_000,
      stdio: "pipe",
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: String(err.stdout ?? err.message) };
  }
}

async function roomActivity(roomId) {
  const boot = await request("/api/bootstrap");
  const room = boot.rooms.find((item) => item.id === roomId);
  if (!room) return { found: false, idle: true, floor: null, queued: [] };
  const activity = room.activity ?? {};
  const floor = activity.floor ?? null;
  const queued = activity.queued ?? [];
  return { found: true, idle: !floor && queued.length === 0, floor, queued, room };
}

async function waitFor(workspace, roomId, startedAt) {
  const deadline = Date.now() + timeoutSec * 1000;
  let idleSince = null;
  let lastTest = { ok: false, out: "" };
  let messages = [];
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    lastTest = testIn(workspace);
    const activity = await roomActivity(roomId);
    try {
      const res = await request(`/api/rooms/${encodeURIComponent(roomId)}/messages`);
      messages = (res.messages ?? []).filter((m) => m.createdAt >= startedAt);
    } catch {
      // room may not be readable yet
    }
    const agentReplied = messages.some((m) => m.kind === "agent");
    if (lastTest.ok && activity.idle && agentReplied) {
      if (idleSince === null) idleSince = Date.now();
      if (Date.now() - idleSince >= graceSec * 1000) break;
    } else {
      idleSince = null;
    }
    const last = messages.at(-1);
    if (last) {
      process.stdout.write(
        `\r  ${Math.round((Date.now() - startedAt) / 1000)}s tests=${lastTest.ok ? "pass" : "fail"} floor=${activity.floor ?? "-"} last=${String(
          last.text ?? "",
        )
          .slice(0, 50)
          .replace(/\n/g, " ")}   `,
      );
    }
  }
  process.stdout.write("\n");
  return { lastTest, messages, timedOut: Date.now() >= deadline };
}

async function createArmAgents(prefix, arm, workspace, templates) {
  const created = [];
  for (const role of arm.roles) {
    const template = templates.find((t) => t.id === role);
    const data = await request("/api/agents", {
      method: "POST",
      body: {
        username: `${prefix}-${SHORT[role] ?? role}`,
        displayName: `Bench ${template?.name ?? role}`,
        runtime: "claude",
        templateId: role,
        toolsMode: "template",
        cwd: workspace,
        systemPrompt:
          "这是自动化 benchmark。只按任务消息和角色卡执行；不要修改 test/ 或 docs/spec.md；不要向人类请求无关确认。",
      },
    });
    created.push(data);
  }
  return created;
}

async function cleanup(roomId, agentIds) {
  if (keep) return;
  try {
    await request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" });
  } catch {
    // already gone
  }
  for (const id of agentIds) {
    try {
      await request(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // already gone
    }
  }
}

async function runOne(armId, runIndex, templates) {
  const arm = ARMS[armId];
  if (!arm) throw new Error(`unknown arm: ${armId}`);
  const runKey = `${Date.now().toString(36)}${runIndex}${armId.slice(0, 1)}`.toLowerCase();
  const prefix = `bench${runKey}`;
  const workspace = join(dataRoot, `${taskId}-${runKey}-${armId}`);
  mkdirSync(workspace, { recursive: true });
  cpSync(TASK_ROOT, workspace, { recursive: true });

  const testBefore = sha(join(workspace, "test", "money.test.mjs"));
  const initialTest = testIn(workspace);
  const beforeAudit = auditLines().length;
  const startedAt = Date.now();
  console.log(`\n[${armId} run ${runIndex}] ${localTime()} workspace=${relative(appRoot, workspace)}`);

  let agents = [];
  let roomId = null;
  try {
    agents = await createArmAgents(prefix, arm, workspace, templates);
    const ids = agents.map((a) => a.id);
    const room =
      arm.room === "dm"
        ? await request("/api/rooms", { method: "POST", body: { kind: "dm", agentId: ids[0] } })
        : await request("/api/rooms", {
            method: "POST",
            body: { kind: "group", name: `${arm.name} ${runKey}`, agentIds: ids },
          });
    roomId = room.room.id;
    console.log(`  agents=${ids.join(",")} room=${roomId} initialTests=${initialTest.ok ? "pass" : "fail"}`);
    await request(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
      method: "POST",
      body: { text: arm.prompt(workspace) },
    });

    const wait = await waitFor(workspace, roomId, startedAt);
    const testAfter = sha(join(workspace, "test", "money.test.mjs"));
    const lines = auditLines().slice(beforeAudit);
    const usage = lines.filter((o) => o.kind === "usage" && ids.includes(o.agentId));
    const tools = lines.filter((o) => o.kind === "tool_use" && ids.includes(o.agentId));
    const agentMessages = wait.messages.filter((m) => m.kind === "agent");
    const result = {
      arm: armId,
      run: runIndex,
      task: taskId,
      prefix,
      roomId,
      agentIds: ids,
      workspace: relative(appRoot, workspace),
      initialPassed: initialTest.ok,
      passed: wait.lastTest.ok,
      testUnchanged: testBefore === testAfter,
      timedOut: wait.timedOut,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      turns: usage.length,
      costUsd: Number(usage.reduce((sum, o) => sum + (Number(o.costUsd) || 0), 0).toFixed(6)),
      agentMessages: agentMessages.length,
      humanMessages: 1,
      toolUses: tools.length,
      toolsByAgent: Object.fromEntries(ids.map((id) => [id, tools.filter((t) => t.agentId === id).length])),
      messages: agentMessages.map((m) => ({
        sender: m.sender,
        intent: m.intent,
        text: String(m.text ?? "").slice(0, 500),
      })),
      testTail: String(wait.lastTest.out).slice(-1200),
    };
    await cleanup(roomId, ids);
    return result;
  } catch (err) {
    if (roomId)
      await cleanup(
        roomId,
        agents.map((a) => a.id),
      ).catch(() => {});
    throw err;
  }
}

function summarize(results) {
  const byArm = {};
  for (const r of results) {
    const rows = (byArm[r.arm] ??= []);
    rows.push(r);
  }
  const summary = {};
  for (const [arm, rows] of Object.entries(byArm)) {
    const avg = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    summary[arm] = {
      runs: rows.length,
      passed: rows.filter((row) => row.passed).length,
      testUnchanged: rows.filter((row) => row.testUnchanged).length,
      avgSeconds: Math.round(avg("seconds")),
      avgTurns: Number(avg("turns").toFixed(2)),
      avgCostUsd: Number(avg("costUsd").toFixed(4)),
      avgAgentMessages: Number(avg("agentMessages").toFixed(2)),
      costPerPassUsd: Number(
        (
          rows.reduce((sum, row) => sum + row.costUsd, 0) /
          Math.max(1, rows.filter((row) => row.passed).length)
        ).toFixed(4),
      ),
    };
  }
  return summary;
}

async function main() {
  if (!existsSync(TASK_ROOT)) throw new Error(`task not found: ${TASK_ROOT}`);
  for (const arm of arms) if (!ARMS[arm]) throw new Error(`unknown arm: ${arm}`);
  await request("/api/health");
  const templates = (await request("/api/role-templates")).templates ?? [];
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${taskId}`;
  const outDir = join(dataRoot, runId);
  mkdirSync(outDir, { recursive: true });
  console.log(`Benchmark ${taskId}: arms=${arms.join(",")} runs=${runs} timeout=${timeoutSec}s`);
  console.log(`Results dir: ${outDir}`);
  if (arms.includes("squad"))
    console.log("WARNING: squad creates 6 real Claude agents per run; expect real cost.");

  const results = [];
  for (let run = 1; run <= runs; run++) {
    for (const arm of arms) {
      results.push(await runOne(arm, run, templates));
    }
  }
  const summary = summarize(results);
  const output = { task: taskId, arms, runs, createdAt: new Date().toISOString(), results, summary };
  writeFileSync(join(outDir, "results.json"), JSON.stringify(output, null, 2) + "\n");
  console.log("\n=== Summary ===");
  console.table(summary);
  console.log(`Wrote ${join(outDir, "results.json")}`);
}

main().catch((err) => {
  console.error("\nbenchmark failed:", err.message);
  process.exitCode = 1;
});
