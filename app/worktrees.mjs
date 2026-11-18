// Minimal git worktree lifecycle for agent workspaces.
//
// This does not merge branches; it only gives an agent an isolated checkout
// and branch so coding agents do not share a working tree.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  }).trim();
}

export function repoRoot(repoPath) {
  const repo = resolve(String(repoPath));
  if (!existsSync(repo)) throw new Error("repo not found");
  const root = git(repo, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("not a git repository");
  return resolve(root);
}

export function createWorktree({ repoPath, agentName, base = "HEAD", rootDir, stamp = Date.now() }) {
  const repo = repoRoot(repoPath);
  const safeName =
    String(agentName)
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .slice(0, 40) || "agent";
  const branch = `agent/${safeName}/${stamp.toString(36)}`;
  const path = join(resolve(rootDir), `${safeName}-${stamp.toString(36)}`);
  mkdirSync(resolve(rootDir), { recursive: true });
  git(repo, ["worktree", "add", "-b", branch, path, base]);
  return { repo, path, branch };
}

export function removeWorktree({ repo, path }) {
  if (!repo || !path) throw new Error("repo and path required");
  git(repo, ["worktree", "remove", "--force", path]);
  return true;
}

export function listWorktrees(repoPath) {
  const repo = repoRoot(repoPath);
  return git(repo, ["worktree", "list", "--porcelain"]);
}
