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
    "   修法：cd frontend && pnpm install --force（普通 pnpm install 命中缓存不修 shim，必须 --force）。",
  );
  console.error(
    "   ⚠️ 不要误判成 openapi-typescript 包本身坏了——它没问题，只是 shim 没建。",
  );
  process.exit(1);
}

assertOpenapiTypescriptShim();

// 1. dump 最新 openapi.json（uv 在 backend 目录跑 dump_openapi.py）
console.log("[gen-api-types] dumping openapi.json from backend ...");
try {
  execSync("uv run python scripts/dump_openapi.py", {
    cwd: backendRoot,
    stdio: "inherit",
  });
} catch {
  console.error(
    "[gen-api-types] ❌ backend dump_openapi.py 失败（见上方真实错误输出）。",
  );
  console.error(
    "   常见：backend/.venv 未装 / dump_openapi.py 缺依赖 / 后端 app import 报错。先在 backend 目录 `uv run python scripts/dump_openapi.py` 单独排查。",
  );
  process.exit(1);
}

if (!existsSync(openapiJson)) {
  console.error(
    `[gen-api-types] ❌ ${openapiJson} 在 dump 后仍不存在。检查 dump_openapi.py 写盘逻辑。`,
  );
  process.exit(1);
}

// 2. 生成 TS 类型（--no-install：必须用已安装的 openapi-typescript，避免联网）
console.log(`[gen-api-types] generating ${outFile} ...`);
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
