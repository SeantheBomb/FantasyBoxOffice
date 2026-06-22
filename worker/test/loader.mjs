// Custom ESM loader that appends .js to bare relative imports.
// Cloudflare Workers resolves "./foo" → "./foo.js" automatically;
// Node ESM does not. This bridges the gap for local testing.

import { existsSync } from "fs";
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

export function resolve(specifier, context, nextResolve) {
  // Only handle relative imports without extensions
  if (specifier.startsWith(".") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const parentDir = dirname(parentPath);
    const candidate = resolvePath(parentDir, specifier + ".js");
    if (existsSync(candidate)) {
      return nextResolve(specifier + ".js", context);
    }
  }
  return nextResolve(specifier, context);
}
