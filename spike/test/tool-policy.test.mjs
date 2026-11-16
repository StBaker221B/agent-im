import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeToolArgs,
  normalizeApprovedTools,
  toolArgsFor,
} from "../../app/tool-policy.mjs";

const template = { tools: { allow: ["Read", "Glob"] } };
const ALL = "Read,Glob,Grep,PowerShell,Edit,Write";

test("tools off denies every tool with --tools empty", () => {
  assert.deepEqual(toolArgsFor(template, "off", "claude"), [
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
  ]);
});

test("approved tools are the only tools available when mode is off", () => {
  assert.deepEqual(toolArgsFor(template, "off", "claude", ["PowerShell"]), [
    "--tools",
    "PowerShell",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "PowerShell",
  ]);
});

test("template mode merges template tools and approved grants", () => {
  assert.deepEqual(toolArgsFor(template, "template", "claude", ["Edit"]), [
    "--tools",
    "Read,Glob,Edit",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Read,Glob,Edit",
  ]);
});

test("full mode exposes all tools", () => {
  const args = toolArgsFor(template, "full", "claude");
  assert.equal(args[0], "--tools");
  assert.equal(args[1], ALL);
  assert.equal(args.at(-1), ALL);
});

test("script runtimes get no tool flags", () => {
  assert.deepEqual(toolArgsFor(template, "full", "script"), []);
});

test("normalizeApprovedTools filters unknown tools and duplicates", () => {
  assert.deepEqual(normalizeApprovedTools(["Read", "Read", "Bash", "Edit"]), ["Read", "Edit"]);
  assert.deepEqual(normalizeApprovedTools("Read"), []);
});

test("mergeToolArgs keeps unrelated flags but replaces stale tool policy", () => {
  assert.deepEqual(
    mergeToolArgs(["--model", "x", "--permission-mode", "auto", "--allowedTools", "Read", "--tools", "Read"], [
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
    ]),
    ["--model", "x", "--tools", "", "--permission-mode", "dontAsk"],
  );
});
