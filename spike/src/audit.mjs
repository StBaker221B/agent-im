// Append-only JSONL audit log. Tokens and raw auth data must never be passed in.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class AuditLog {
  constructor(path = null) {
    this.path = path;
    if (path) mkdirSync(dirname(path), { recursive: true });
  }

  write(event) {
    if (!this.path) return;
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf8");
  }
}
