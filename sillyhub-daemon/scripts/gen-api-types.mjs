// 从 backend/openapi.json 生成 sillyhub-daemon/src/api-types.ts
//
// daemon 调 backend 的 HTTP 端点（lease claim/heartbeat/complete、audit、
// runtime、session 等），这些端点全在 backend 已暴露的 openapi.json 里。
// 复用前端那份 openapi.json 作为单一契约源，消除 daemon 端手写 TS 类型漂移。
//
// 用法（在 sillyhub-daemon 目录）::
//
//     pnpm gen:types        // 生成
//     pnpm gen:types:check  // 重新生成 + git diff --exit-code（守门）
//
// 注：openapi.json 由 backend/scripts/dump_openapi.py 产出（前端 gen:types
// 已自动刷新）；本脚本不重新 dump，只消费已存在的 openapi.json，避免 daemon
// 端依赖 Python/uv 环境。

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const backendRoot = resolve(here, "..", "..", "backend");
const openapiJson = resolve(backendRoot, "openapi.json");
const outFile = resolve(root, "src", "api-types.ts");

if (!existsSync(openapiJson)) {
  console.error(
    `[gen-api-types] ${openapiJson} 不存在；请先在 backend 跑 \`uv run python scripts/dump_openapi.py\` 或在前端跑 \`pnpm gen:types\` 刷新`,
  );
  process.exit(1);
}

console.log(`[gen-api-types] generating ${outFile} from ${openapiJson} ...`);
execSync(`npx --no-install openapi-typescript "${openapiJson}" -o "${outFile}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`[gen-api-types] done: ${outFile}`);
