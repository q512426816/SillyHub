---
author: qinyi
created_at: 2026-07-04T00:51:06
---

# design — 后端 OpenAPI 自动生成前端 TypeScript 类型

## 1. 背景

见 proposal.md。前端手写类型漂移（pending 铁证），后端 `/api/openapi.json`（main.py:96）已现成且与代码强一致。

## 2. 设计目标

1. `pnpm gen:types` 从后端导出的 openapi.json 生成 `frontend/src/lib/api-types.ts`
2. 生成的类型被实际使用：health.ts 示范迁移后 `tsc` 通过
3. CI/pre-commit 守门：openapi 改动但 api-types 未同步 → 提醒
4. 跨平台（Win/Linux/macOS）、零运行时开销（type-only）
5. 复用现有 apiFetch，不替换请求层

## 3. 非目标

- 全量迁移 33 模块（仅 health.ts 示范）
- 后端 dict→Pydantic 大规模改造（quick_chat 等）；不含 health 端点补响应模型这种本变更范围内的小修
- daemon JSON Schema 共享
- 运行时校验（zod/ajv）
- mypy disable_error_code 清理

## 4. 拆分判断

单一功能模块（类型生成工具链闭环），任务约 6 个 < 10，无多角色 / 多页面状态流转。不走批量模式，不拆 MASTER。

## 5. 总体方案（6 Phase）

### Phase 1 — 后端 OpenAPI 静态导出

新增 `backend/scripts/dump_openapi.py`：

```python
"""静态导出 FastAPI OpenAPI schema 到 JSON 文件，供前端类型生成消费。

不启动 uvicorn、不连 DB/Redis —— FastAPI 的 openapi schema 在 app 构建时
生成（lifespan 不跑），因此 dump 是纯函数式、CI 友好、跨平台。
"""
import json
import sys
from pathlib import Path


def main() -> int:
    from app.main import app

    schema = app.openapi()
    out = Path(__file__).resolve().parent.parent / "openapi.json"
    out.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"wrote {out} ({len(schema.get('paths', {}))} paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

要点：
- 路径用 pathlib，跨平台
- 输出 `backend/openapi.json`（提交进 git，作为前端生成的输入源；稳定可 diff）
- 不依赖 DB/Redis（lifespan 不触发，`app.openapi()` 是纯构建期产物）

### Phase 2 — 前端类型生成工具链

新增 devDep：`openapi-typescript`（^7）。

新增 `frontend/scripts/gen-api-types.mjs`：

```javascript
// 从 backend/openapi.json 生成 src/lib/api-types.ts
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const backendRoot = resolve(here, "..", "..", "backend");
const openapiJson = resolve(backendRoot, "openapi.json");
const outFile = resolve(root, "src", "lib", "api-types.ts");

const dumpScript = resolve(backendRoot, "scripts", "dump_openapi.py");

// 1. dump 最新 openapi.json（uv 在 backend 目录）
execSync(`uv run python scripts/dump_openapi.py`, {
  cwd: backendRoot,
  stdio: "inherit",
});

// 2. 生成 TS 类型
execSync(`npx openapi-typescript "${openapiJson}" -o "${outFile}"`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`generated ${outFile}`);
```

`package.json` scripts：

```json
{
  "gen:types": "node scripts/gen-api-types.mjs",
  "gen:types:check": "node scripts/gen-api-types.mjs && git diff --exit-code src/lib/api-types.ts"
}
```

要点：
- `gen:types` 一条命令完成 dump + 生成
- `gen:types:check` 重新生成 + `git diff --exit-code`，用于守门（生成的文件若有 diff 说明提交者忘同步）

### Phase 3 — 生成首版 api-types.ts

- 跑 `pnpm gen:types`，产出 `frontend/src/lib/api-types.ts`
- 提交进 git（连同 `backend/openapi.json`）
- 验证：含 `paths`、`components.schemas`；`WorkspaceStatus` 应是 `"pending" | "active" | "archived" | "deleted"`（漂移修复）

### Phase 4 — 示范迁移 health.ts

`frontend/src/lib/health.ts` 从手写 interface 改为引用 `api-types.ts`：

```typescript
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

type HealthResponse = components["schemas"]["HealthResponse"];

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health");
}
```

注意：若 `/api/health` 当前返回 `dict`（OpenAPI 无 schema），迁移前需在后端给 health 端点补一个 `HealthResponse` Pydantic 响应模型（小修，属本变更范围；区别于 quick_chat 那类大改）。execute 阶段核实后端 router 现状再决定。

其余 32 模块迁移作为后续 task，不在本轮。

### Phase 5 — 守门接入

改 `.claude/hooks/pre-commit-ci-check.cjs`，加**提醒式**检查（非 block）：

```javascript
// 在 hasBackend 分支内，mypy 之后追加：
const schemaChanged = files.some(
  (f) => f.startsWith("backend/app/modules/") && f.endsWith("schema.py")
);
const apiTypesSynced = files.includes("frontend/src/lib/api-types.ts") ||
  files.includes("backend/openapi.json");
if (schemaChanged && !apiTypesSynced) {
  log("提醒: 后端 schema.py 改动，建议跑 `pnpm gen:types` 同步前端类型（本次不拦截）");
}
```

要点：
- 提醒式（log 到 stderr），不 deny commit
- 避免在 commit 时跑 Python dump（慢、可能没装 uv）
- 强制 block 留后续（待全量迁移后开启）

### Phase 6 — 测试 + 验收

- backend：`ruff check`、`ruff format --check`、`mypy app`、`pytest`
- frontend：`lint`、`typecheck`、`test`、`build`
- `gen:types:check` 守门验证（exit 0）

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/scripts/dump_openapi.py` | 静态导出 openapi.json |
| 新增 | `backend/openapi.json` | dump 产物（git 提交，前端输入源）|
| 新增 | `frontend/scripts/gen-api-types.mjs` | dump + 生成 ts 一体脚本 |
| 新增 | `frontend/src/lib/api-types.ts` | 生成的类型（git 提交）|
| 改 | `frontend/package.json` | 加 devDep openapi-typescript + scripts |
| 改 | `frontend/src/lib/health.ts` | 示范迁移：手写 → 引用 api-types |
| 改 | `.claude/hooks/pre-commit-ci-check.cjs` | 提醒式守门 |
| 改（视情况）| `backend/app/modules/health/router.py` | 若 /api/health 返回 dict 无 schema，补 Pydantic 响应模型 |

## 7. 决策记录

| ID | 决策 | 理由 |
|---|---|---|
| D-001@V1 | 工具选 openapi-typescript | 轻量、纯类型、不绑请求生成、复用 apiFetch |
| D-002@V1 | 静态 dump openapi.json（非 fetch 活服务）| CI 友好、不依赖 backend 起服务 |
| D-003@V1 | api-types.ts + openapi.json 提交进 git | CI 能 diff 守门、review 可见 |
| D-004@V1 | 守门提醒式（非强制 block）| 避免 commit 跑 Python dump 拖慢；全量迁移后再开强制 |
| D-005@V1 | 仅 health.ts 示范迁移 | YAGNI + 控制本轮风险；全量迁移作为后续 task |

## 7.5 生命周期契约表

本变更**不涉及**任何运行时生命周期（session / lease / agent_run / daemon / lifecycle）。仅是静态构建期工具链：dump_openapi.py 在构建期读 `app.openapi()`，不连 DB、不跑 lifespan、不创建任何 session/lease/agent_run；类型生成是纯文件转换，无运行时状态。

| 实体 | 是否涉及 | 说明 |
|---|---|---|
| session | 否 | 不碰 interactive session |
| lease | 否 | 不碰 daemon lease |
| agent_run | 否 | 不碰 agent run 状态机 |
| daemon | 否 | 仅在「非目标」里提及 daemon JSON Schema 共享是独立变更；本变更不碰 daemon 通信 |
| lifecycle | 否 | `app.openapi()` 不触发 FastAPI lifespan（lifespan 仅在 uvicorn 启动时跑）|

## 8. 风险与缓解

- 后端部分端点返回 dict（quick_chat 等）→ 生成类型弱。本变更**不修**，记入非目标；后续独立变更逐模块补 Pydantic。
- `openapi.json` 体积 → 仅 schema 文本，~百 KB 级，git 可接受。
- 生成命令依赖 `uv`（后端）+ `npx`（前端）→ 文档明确，pre-commit 不强制跑。

## 9. 跨平台

- `dump_openapi.py` 用 pathlib，跨平台 ✓
- `gen-api-types.mjs` 用 node:path + node:child_process，跨平台 ✓
- `openapi-typescript` 是纯 npm 工具 ✓

## 10. 自审

| 检查项 | 结果 |
|---|---|
| 四件套齐全（proposal / design / requirements / tasks）| ✓ |
| design 章节（背景 / 目标 / 非目标 / 拆分 / 方案 / 文件清单 / 决策 / 生命周期 / 风险 / 跨平台）| ✓ |
| 决策记录 D-001~005@V1（大写 @V1 避校验 case bug）| ✓ |
| 非目标 5 项明确（防 scope creep）| ✓ |
| 生命周期契约表（声明不涉及运行时生命周期）| ✓ |
| 文件清单完整（新增 4 + 改 3 + 视情况 1）| ✓ |
| 跨平台（Win / Linux / macOS）| ✓ |
| 风险识别与缓解 | ✓ |
| Grill 修正（非目标边界澄清）| ✓ |

自审结论：可进入 plan 阶段。
