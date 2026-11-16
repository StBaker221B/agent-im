// Run the supervisor against a real Matrix homeserver.
// Usage: npm run matrix-gateway [-- path/to/config.json]
// The config is produced by scripts/setup-matrix.mjs.

import { runSupervisor } from "./supervisor.mjs";

const configPath = process.argv[2] ?? ".tmp/matrix-config.json";

runSupervisor(configPath).catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exitCode = 1;
});
