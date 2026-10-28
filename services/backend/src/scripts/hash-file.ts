// Manual-test tool (steps 6 and 7): prints the shared/hash of a JSON file's contents.
// Usage: npm run hash-file -- path/to/bundle.json
import { readFileSync } from "node:fs";
import { hashBundle } from "../../../../shared/hash/index.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run hash-file -- <bundle.json>");
  process.exit(1);
}
console.log(hashBundle(JSON.parse(readFileSync(path, "utf8"))));
