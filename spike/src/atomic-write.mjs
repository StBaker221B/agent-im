// Write a small state file atomically: write a sibling temp file, then rename.
// This prevents a crash mid-write from leaving a truncated state.json/tasks.json.

import { renameSync, unlinkSync, writeFileSync } from "node:fs";

export function writeFileAtomic(path, data, encoding = "utf8") {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, data, encoding);
  try {
    renameSync(temp, path);
  } catch (err) {
    // Windows can refuse replacing an existing file in rare cases; retry once.
    try {
      unlinkSync(path);
    } catch {
      // destination may not exist
    }
    try {
      renameSync(temp, path);
    } catch {
      try {
        unlinkSync(temp);
      } catch {
        // best effort
      }
      throw err;
    }
  }
}
