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

// node_modules 健康自检：openapi-typescript 的 .bin shim 必须在。
// pnpm 半坏场景（CLAUDE.md 规则 20）：包目录 node_modules/openapi-typescript 在（符号链接），
// 但 node_modules/.bin/openapi-typescript shim 没建 → npx --no-install 找不到命令 →
// execSync 抛裸 Error（stdout:null/stderr:null），极易误判成「openapi-typescript 坏了」。
// 实际只需 pnpm install --force 重建 shim（普通 pnpm install 命中缓存不修 shim）。
function assertOpenapiTypescriptShim() {
  const binDir = resolve(root, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["openapi-typescript.CMD", "openapi-typescript"]
      : ["openapi-typescript"];
  if (candidates.some((c) => existsSync(resolve(binDir, c)))) {
    return;
  }
  const expected = candidates.map((c) => resolve(binDir, c)).join(" 或 ");
  const pkgPresent = existsSync(
    resolve(root, "node_modules", "openapi-typescript"),
  );
  console.error(
    `[gen-api-types] ❌ openapi-typescript .bin shim 缺失（期望 ${expected}）。`,
  );
  console.error(
    pkgPresent
      ? "   node_modules/openapi-typescript 包目录在但 .bin shim 没建 → 典型 node_modules 半坏（CLAUDE.md 规则 20）。"
      : "   node_modules/openapi-typescript 包也不在 → openapi-typescript 未安装。",
  );
  console.error(
    "   修法：cd sillyhub-daemon && pnpm install --force（普通 pnpm install 命中缓存不修 shim，必须 --force）。",
  );
  console.error(
    "   ⚠️ 不要误判成 openapi-typescript 包本身坏了——它没问题，只是 shim 没建。",
  );
  process.exit(1);
}

assertOpenapiTypescriptShim();

console.log(`[gen-api-types] generating ${outFile} from ${openapiJson} ...`);
try {
  execSync(`npx --no-install openapi-typescript "${openapiJson}" -o "${outFile}"`, {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  console.error(
    "[gen-api-types] ❌ openapi-typescript 生成失败（见上方真实错误输出）。",
  );
  console.error(
    "   若提示找不到命令：node_modules 半坏，跑 `pnpm install --force` 重建 .bin shim（CLAUDE.md 规则 20）。",
  );
  process.exit(1);
}

console.log(`[gen-api-types] done: ${outFile}`);
