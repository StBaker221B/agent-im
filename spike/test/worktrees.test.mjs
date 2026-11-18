import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, mergeWorktree, removeWorktree } from "../../app/worktrees.mjs";

test("create and remove an isolated git worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentim-worktree-"));
  const repo = join(dir, "repo");
  const root = join(dir, "worktrees");
  try {
    execFileSync("git", ["init", repo], { stdio: "pipe" });
    writeFileSync(join(repo, "README.md"), "hello\n");
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "add",
        ".",
      ],
      { stdio: "pipe" },
    );
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ],
      { stdio: "pipe" },
    );
    const wt = createWorktree({ repoPath: repo, agentName: "coder", rootDir: root });
    assert.ok(existsSync(join(wt.path, "README.md")));
    assert.match(wt.branch, /^agent\/coder\//);
    writeFileSync(join(wt.path, "README.md"), "hello from agent\n");
    execFileSync(
      "git",
      [
        "-C",
        wt.path,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-am",
        "agent change",
      ],
      { stdio: "pipe" },
    );
    mergeWorktree({ repo, branch: wt.branch, message: "merge test" });
    assert.match(readFileSync(join(repo, "README.md"), "utf8"), /hello from agent/);
    removeWorktree(wt);
    assert.equal(existsSync(wt.path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
