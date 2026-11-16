// Tool policy shared by the control plane and the gateway host.
//
// The Claude CLI defaults to auto permission mode when it receives no
// --permission-mode flag. That means toolsMode=off must still pass dontAsk;
// otherwise a "no tools" agent can edit files. Keep the policy in one place.

import { FULL_TOOL_LIST } from "./role-templates.mjs";

const TOOL_FLAGS = new Set(["--permission-mode", "--allowedTools", "--tools"]);

export function toolArgsFor(template, mode, runtime, approvedTools = []) {
  if (runtime !== "claude") return [];
  const base = mode === "full" ? FULL_TOOL_LIST : mode === "off" ? [] : (template?.tools?.allow ?? []);
  const allow = [...new Set([...base, ...approvedTools])];
  if (!allow.length) return ["--tools", "", "--permission-mode", "dontAsk"];
  return ["--tools", allow.join(","), "--permission-mode", "dontAsk", "--allowedTools", allow.join(",")];
}

export function normalizeApprovedTools(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String).filter((tool) => FULL_TOOL_LIST.includes(tool)))];
}

/** Keep non-tool extra args, but always apply the current tool policy. */
export function mergeToolArgs(base = [], toolArgs = []) {
  const kept = [];
  for (let i = 0; i < base.length; i++) {
    const arg = base[i];
    if (TOOL_FLAGS.has(arg)) {
      const value = base[i + 1];
      if (value && !value.startsWith("--")) i++;
      continue;
    }
    kept.push(arg);
  }
  return [...kept, ...toolArgs];
}
