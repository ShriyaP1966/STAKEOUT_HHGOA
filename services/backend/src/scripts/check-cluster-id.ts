// Manual-test tool: validates a cluster id with the same helper the backend uses.
// Usage: npm run check-cluster-id -- <value>
import { parseClusterId } from "../clusterId.js";

try {
  console.log(`valid: ${parseClusterId(process.argv[2])}`);
} catch (e) {
  console.log(`rejected: ${(e as Error).message}`);
  process.exitCode = 1;
}
