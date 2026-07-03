// 从 backend/openapi.json 生成 frontend/src/lib/api-types.ts
//
// 流程：先跑后端 dump_openapi.py 刷新 openapi.json，再用 openapi-typescript
// 生成 TypeScript 类型。一条命令完成 dump + 生成，CI 友好、跨平台。
//
// 用法（在 frontend 目录）::
//
//     pnpm gen:types        // dump + 生成
//     pnpm gen:types:check  // 重新生成 + git diff --exit-code（守门）

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const backendRoot = resolve(here, "..", "..", "backend");
const openapiJson = resolve(backendRoot, "openapi.json");
const outFile = resolve(root, "src", "lib", "api-types.ts");

// 1. dump 最新 openapi.json（uv 在 backend 目录跑 dump_openapi.py）
console.log("[gen-api-types] dumping openapi.json from backend ...");
execSync("uv run python scripts/dump_openapi.py", {
  cwd: backendRoot,
  stdio: "inherit",
});

if (!existsSync(openapiJson)) {
  console.error(
    `[gen-api-types] expected ${openapiJson} after dump, not found`,
  );
  process.exit(1);
}

// 2. 生成 TS 类型（--no-install：必须用已安装的 openapi-typescript，避免联网）
console.log(`[gen-api-types] generating ${outFile} ...`);
execSync(`npx --no-install openapi-typescript "${openapiJson}" -o "${outFile}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`[gen-api-types] done: ${outFile}`);
