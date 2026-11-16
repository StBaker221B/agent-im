// Tool policy shared by the control plane and the gateway host.
//
// The Claude CLI defaults to auto permission mode when it receives no
// --permission-mode flag. That means toolsMode=off must still pass dontAsk;
// otherwise a "no tools" agent can edit files. Keep the policy in one place.

import { FULL_TOOL_LIST } from "./role-templates.mjs";

const TOOL_FLAGS = new Set(["--permission-mode", "--allowedTools"]);

export function toolArgsFor(template, mode, runtime) {
  if (runtime !== "claude") return [];
  const allow = mode === "full" ? FULL_TOOL_LIST : mode === "off" ? [] : (template?.tools?.allow ?? []);
  if (!allow.length) return ["--permission-mode", "dontAsk"];
  return ["--permission-mode", "dontAsk", "--allowedTools", allow.join(",")];
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
