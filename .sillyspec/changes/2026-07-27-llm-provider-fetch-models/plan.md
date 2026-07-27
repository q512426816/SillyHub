---
author: qinyi
created_at: 2026-07-27 09:42:30
plan_level: full
---

# 实现计划（Plan）— LLM 供应商：获取模型列表 + 一键设置 + 配置 JSON 编辑器

> 来源：design.md（scale=large, revision 2, D-001~D-009 全 confirmed）+ requirements.md（FR-01~FR-10, AC-01~AC-07）+ tasks.md（14 task 草案）。
> 本计划在 tasks.md 基础上**细化依赖、落地行号、修正 task-06**（spike-01 发现 daemon 无 settings.json 生成处）。

## Spike 前置验证

| Spike | 验证内容 | 结论 | 不通过后果 |
|---|---|---|---|
| spike-01（已完成，本步） | daemon 是否存在「生成 Claude settings.json 的函数」可合并 settings_config 顶层键 | **不存在**。daemon 全源码无 settings.json 写入；`spawn-env.ts:151-155` + `config.ts:55-60` 注释明确「CLAUDE_CONFIG_DIR 无 settings.json，只用注入 env」（ql-20260726-002-1180 隔离）。claude spawn 公共瓶颈 = `buildSpawnEnv`（spawn-env.ts:109），被 `task-runner.ts:548`（batch）+ `daemon.ts:2906`（interactive）调用；CLAUDE_CONFIG_DIR mkdir 在 `cli.ts:287` | task-06 由「合并进已有生成处」**改为「daemon 新增生成 `$CLAUDE_CONFIG_DIR/settings.json` 的能力」**。design D-009 决策（改 daemon 完整闭环）不变，仅实现路径修正 |
| spike-02（task-06 内联，低风险） | claude code 是否读取 `$CLAUDE_CONFIG_DIR/settings.json` 的 attribution/enabledPlugins/skipDangerousModePermissionPrompt/model 顶层键 | 预期是（cc-switch 范式 + claude code 官方 settings.json 契约）；execute task-06 用真跑 claude 验 AC-05 兜底 | 若某顶层键不被识别 → 该键降级为「仅存储不生效」，不阻断其它键；attribution 是 5 开关里唯一无 env 等价物的项 |
| spike-03（task-10 内联） | cc-switch `JsonEditor.tsx` 是否易移植（依赖/行号/折叠） | 倾向移植（design D-005 全套对齐）；execute task-10 起手先读 `C:\Users\qinyi\IdeaProjects\cc-switch` 对应文件 | 若重依赖 monaco → 改自研 textarea+行号+折叠（轻量） |

> spike-01 是计划期硬发现，**已修正 task-06 范围**。spike-02/03 留 execute 内联，不阻断计划。

## 关键路径与并行策略

```
Wave 1（后端）──┬─ task-01 字段+migration ──┬─ task-02 fetch端点 ─ task-03 SSRF
                └─ task-04 context透传      （Wave1 内 task-02→task-03，其余并行）

Wave 2（daemon）─ task-05 toEnv合并env ─ task-07 bundle
                 task-06 新增settings.json生成 ─ task-07 bundle
                 （Wave2 仅依赖 design §5.2 类型契约，可与 Wave1 并行；运行期需 task-01/04 落地）

Wave 3（前端）── task-08 组件 ──┐
                 task-11 api+类型 ─┼─ task-09 角色映射区 ─ task-14 测试
                                  └─ task-10 配置JSON区 ─ task-14 测试

Wave 4（测试）── task-12 后端 / task-13 daemon / task-14 前端（依赖对应 Wave 实现）
```

- **并行子代理**：Wave 1（task-01/04 一组、task-02/03 一组）与 Wave 2（task-05、task-06）跨语言无冲突，可并行子代理执行（≤4 并发，规避 429）。Wave 3 task-08/11 并行，task-09/10 待 08/11。
- **跨平台**：所有命令用 `local.yaml` 的 `cd <sub> && <cmd>` 链（Windows/Linux/macOS 通用）。

## Wave 1 — 后端数据模型 + fetch-models + 透传（无前端/daemon 依赖）

- [x] task-01: `backend/app/modules/llm_provider/model.py` 加 `settings_config: dict[str,Any]|None`（JSON 列，nullable）；`schema.py` 的 `LlmProviderCreate`/`LlmProviderUpdate`/`LlmProviderRead` 加同字段；新 migration `202607270900`（接 head `202607251600`，SQLite/PG 方言分支 `ALTER TABLE llm_providers ADD COLUMN settings_config JSON NULL`，down 接真实 head）。（覆盖：FR-06, D-004）
- [x] task-02: `backend/app/modules/llm_provider/router.py` + `service.py` 加 `POST /api/llm-providers/fetch-models`（owner 级 `get_current_user`）：双形态 body（`{provider_id}` 后端 `get_cipher().decrypt(encrypted_api_key, key_id)` 解密 / `{base_url, api_key, auth_field?}` 直传不落库）；`httpx.AsyncClient(timeout=10)`；鉴权头按 auth_field（ANTHROPIC_AUTH_TOKEN→`Authorization: Bearer` / ANTHROPIC_API_KEY→`x-api-key`+`anthropic-version`）；候选 URL 兜底（`/v1/models`→404/405 剥离 `/anthropic`/`/compatibility`/`/api` 再试）；错误分类 `LLM_PROVIDER_AUTH_FAILED`/`_MODELS_UNSUPPORTED`/`_MODELS_ALL_FAILED`/`_MODELS_TIMEOUT`。（覆盖：FR-01, FR-02, FR-03, D-001, D-006）
- [x] task-03: fetch-models SSRF 防护（依赖 task-02 结构）：复用 `backend/app/modules/tool_gateway/tool_policy.py:163-295 _check_not_private_ip`（IPv4Network 成员 + is_reserved，已含 `0.0.0.0/8`）；补 IPv6（`::1`/`fc00::/7`/`fe80::/10`，既有仅 AF_INET）；`socket.getaddrinfo` 必 `await asyncio.to_thread(...)` 包裹防阻塞（对齐 `tool_gateway/service.py:152`）。（覆盖：NFR-01, D-006/Grill B3）
- [x] task-04: `backend/app/modules/daemon/lease/context.py:139-148` `provider_config` dict 加 `"settings_config": provider.settings_config`（透传，不解密不加工）。（覆盖：FR-10 前段, D-009）

## Wave 2 — daemon 下发闭环（依赖 design §5.2 类型契约；运行期依赖 Wave1 task-01/04）

- [x] task-05: `sillyhub-daemon/src/credential-injector.ts`：`ProviderConfig` 类型（`types.ts`）加 `settings_config?: { env?: Record<string,string>; attribution?: ...; enabledPlugins?: ...; model?: string; skipDangerousModePermissionPrompt?: boolean }`；`toEnv(c)` 在现有 `Object.assign(env, c.extra_env ?? {})`（credential-injector.ts:98）**之后**追加 `Object.assign(env, c.settings_config?.env ?? {})`（settings_config.env 覆盖优先级最高）。api_key 永不从 settings_config 取。（覆盖：FR-10 中段, D-007）
- [x] task-06: **【spike-01 修正】** daemon 新增「生成 `$CLAUDE_CONFIG_DIR/settings.json`」能力（**不是合并已有，是新增写文件**）：新建 helper（如 `sillyhub-daemon/src/claude-settings.ts`）把 `provider_config.settings_config` 的顶层键（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt）合并成 settings.json 写盘；在两处 buildSpawnEnv 调用点旁挂钩——`task-runner.ts:548`（batch spawn → `task-runner.ts:1024`）+ `daemon.ts:2906`（interactive spawn）。settings_config absent/null → 不写文件（claude 走默认+注入 env，零回归）。spike-02 内联验顶层键生效。（覆盖：FR-10 后段, D-008, D-009）
- [x] task-07: daemon `pnpm bundle` 重建（credential-injector.ts + 新 helper 改了 `src/`，dist 需重打；随后 backend 镜像 rebuild 才能让 daemon bundle 进生产）。（覆盖：NFR-04）

## Wave 3 — 前端（依赖 Wave1 端点 + 字段）

- [x] task-08: 新建 `frontend/src/components/llm-providers/model-input-with-fetch.tsx`（shadcn DropdownMenu，按 owned_by 分组选；移植 cc-switch `ModelInputWithFetch.tsx`，中文）。props `{value, onChange, fetchedModels?, isLoading?, onFetch?}`。（覆盖：FR-04 组件）
- [x] task-11: `frontend/src/lib/api/llm-providers.ts` 加 `fetchProviderModels({provider_id?} | {base_url, api_key, auth_field?})` → `POST /api/llm-providers/fetch-models`；类型加 `settings_config`；`LlmProviderFormValues` + `formToCreate`/`formToUpdate`（lib/api/llm-providers.ts:232/253）提交 payload 加 `settings_config`。（覆盖：FR-01 前端, FR-06 前端）
- [x] task-09: `frontend/src/components/llm-providers/llm-provider-form.tsx` 角色映射区改造：ROLE_ROWS 表格上方加全局「获取模型列表」+「一键设置」按钮（D-003/D-002）；4 角色 model 单元格（现 llm-provider-form.tsx:362 手填 input）改用 `ModelInputWithFetch` 共享 `fetchedModels`；一键设置取 `sonnet||opus||fable||haiku` 第一非空填全部。（覆盖：FR-04, FR-05, D-002, D-003）— 依赖 task-08, task-11
- [x] task-10: `frontend/src/components/llm-providers/llm-provider-form.tsx` 加「配置 JSON」折叠区（对齐既有 `<details>` 高级选项风格，llm-provider-form.tsx:320）：5 开关 checkbox（D-008 映射，照 cc-switch `CommonConfigEditor:100-157`）toggle 时 parse settings_config → 增删键 → stringify；JsonEditor（spike-03：移植 cc-switch JsonEditor.tsx，否则自研 textarea+行号+折叠+格式化）；「应用通用配置」预设（浅合并 env+enabledPlugins 片段）。（覆盖：FR-07, FR-08, FR-09, D-005, D-008）— 依赖 task-11

## Wave 4 — 测试（依赖对应 Wave 实现）

- [x] task-12: 后端测试 `backend/app/modules/llm_provider/tests/`：fetch-models mock httpx（正常/401→AUTH_FAILED/404→候选兜底/全失败→ALL_FAILED/超时→TIMEOUT/SSRF 拒私网+IPv6/双形态）；migration `alembic upgrade head` 单头 `202607270900`；context.py 透传 settings_config。（覆盖：AC-06, AC-07, NFR-01/02）— 依赖 task-01/02/03/04
- [x] task-13: daemon 测试 `sillyhub-daemon/tests/`：`credential-injector` toEnv 合并 settings_config.env 覆盖 extra_env；新增 helper 写 settings.json 合并顶层（attribution/enabledPlugins）；absent 不写文件。（覆盖：AC-05 daemon 侧, FR-10）— 依赖 task-05/06
- [x] task-14: 前端测试：ModelInputWithFetch（拉取中/下拉选/无 onFetch）；配置 JSON 面板（5 开关 toggle 改 JSON / 格式化 / 应用预设 / JSON 非法不崩）；一键设置。（覆盖：AC-01~AC-04 前端侧）— 依赖 task-08/09/10/11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | settings_config 字段 + schema + migration | 1 | P0 | — | FR-06, D-004 | migration 接 head 202607251600，down 接真实 head |
| task-02 | fetch-models 双形态端点 | 1 | P0 | task-01 | FR-01/02/03, D-001/006 | httpx 异步 + 候选 URL + 错误分类 |
| task-03 | fetch-models SSRF 防护 | 1 | P0 | task-02 | NFR-01, D-006 | 复用 tool_policy._check_not_private_ip + 补 IPv6 + to_thread |
| task-04 | context.py 透传 settings_config | 1 | P1 | task-01 | FR-10前, D-009 | context.py:139-148 provider_config 加 1 字段 |
| task-05 | daemon toEnv 合并 settings_config.env | 2 | P0 | design §5.2 | FR-10中, D-007 | credential-injector.ts:98 之后追加 |
| task-06 | daemon 新增 settings.json 生成（spike-01 修正） | 2 | P0 | design §5.2 | FR-10后, D-008/009 | 新 helper + 挂 task-runner.ts:548 / daemon.ts:2906 |
| task-07 | daemon pnpm bundle 重建 | 2 | P1 | task-05, task-06 | NFR-04 | dist 重打 + backend 镜像 rebuild |
| task-08 | ModelInputWithFetch 组件 | 3 | P0 | — | FR-04组件 | shadcn DropdownMenu，移植 cc-switch |
| task-09 | form 角色映射区 + 获取/一键设置 | 3 | P0 | task-08, task-11 | FR-04/05, D-002/003 | 全局按钮 + 4 角色共享 fetchedModels |
| task-10 | form 配置 JSON 折叠区 | 3 | P0 | task-11 | FR-07/08/09, D-005/008 | 5 开关 + JsonEditor（spike-03）+ 应用预设 |
| task-11 | lib/api fetchProviderModels + 类型 + form payload | 3 | P0 | — | FR-01前, FR-06前 | formToCreate/formToUpdate 加 settings_config |
| task-12 | 后端测试 | 4 | P0 | task-01~04 | AC-06/07, NFR-01/02 | mock httpx + migration 单头 + 透传 |
| task-13 | daemon 测试 | 4 | P0 | task-05, task-06 | AC-05 daemon, FR-10 | toEnv 合并 + settings.json 生成 |
| task-14 | 前端测试 | 4 | P0 | task-08~11 | AC-01~04 前端 | 组件 + 配置面板 + 一键设置 |

## 验收（对照 requirements AC-01~AC-07）

| AC | 覆盖任务 | 验收证据 |
|---|---|---|
| AC-01 新建供应商填 base_url+key → 获取模型 → 下拉选 | task-02, task-08, task-09, task-11 | 前端下拉显示 owned_by 分组模型 |
| AC-02 一键设置填全部 4 角色 | task-09 | 第一非空模型填 sonnet/opus/fable/haiku |
| AC-03 编辑已存供应商 provider_id 解密拉取 | task-02, task-11 | 后端 decrypt 成功拉模型 |
| AC-04 配置 JSON 5 开关 toggle 改 JSON / 格式化 / 应用预设 | task-10 | settings_config 增删键正确 |
| AC-05 daemon 真跑含 settings_config.env 开关 + settings.json 顶层 | task-04, task-05, task-06, task-07 | 真跑 claude 验 env + settings.json（spike-02） |
| AC-06 SSRF 拒私网 / 404 中转站提示未开放 | task-03, task-12 | 错误分类 + SSRF 拒绝测试 |
| AC-07 三端测试全绿 + migration 单头 | task-01, task-12, task-13, task-14 | ruff/mypy+pytest / tsc+vitest 三端 / alembic upgrade head 单头 |

## 覆盖矩阵（决策 → 任务 → AC）

| 决策 | 覆盖任务 | 验收 AC |
|---|---|---|
| D-001 双形态 fetch-models 端点 | task-02 | AC-01, AC-03 |
| D-002 一键应用全部角色 | task-09 | AC-02 |
| D-003 全局获取按钮 | task-09 | AC-01 |
| D-004 新增 settings_config 字段 | task-01 | AC-04, AC-05 |
| D-005 配置 JSON 全套对齐 cc-switch | task-10 | AC-04 |
| D-006 fetch-models 方案 A（httpx+SSRF+候选 URL） | task-02, task-03 | AC-06 |
| D-007 settings_config.env 最后覆盖 | task-05 | AC-05 |
| D-008 5 开关映射 | task-06（attribution 顶层）, task-10（env+UI） | AC-04, AC-05 |
| D-009 改 daemon 完整闭环（spike-01 修正实现路径） | task-04, task-05, task-06, task-07 | AC-05 |

## 风险与边界

1. **spike-01 修正（最高优先级，需人工 review 确认）**：design D-009 原述「在 daemon 已有 settings.json 生成处合并顶层」前提**不成立**——daemon 全源码无 settings.json 写入（刻意的 env-only 隔离设计）。task-06 因此改为「daemon **新增**生成 `$CLAUDE_CONFIG_DIR/settings.json`」。这与 CLAUDE_CONFIG_DIR 隔离意图一致（隔离是为不读宿主 `~/.claude/settings.json`，不是禁止平台自己写），但**引入了 daemon 此前没有的文件写入行为**，execute 需确认：① 写盘时机（spawn 前，非 daemon 启动时）；② 与 cli.ts:287 mkdir 的先后（mkdir 已保证目录存在）；③ 多 lease 并发写同一 CLAUDE_CONFIG_DIR 的覆盖语义（按 daemon 单实例假设，单写）。
2. **attribution 是唯一无 env 等价物的开关**：4/5 开关（Teammates/Tool Search/最大强度思考/禁用自动升级）走 settings_config.env 由 task-05 toEnv 直接生效；仅「隐藏 AI 署名」(attribution) 必须走 task-06 settings.json 顶层。若 spike-02 发现某顶层键不被 claude 识别 → 该键降级「仅存储」，不阻断其余。
3. **SSRF（D-006）**：复用 `_check_not_private_ip` + 补 IPv6 + getaddrinfo 包 to_thread，避免阻塞事件循环。
4. **api_key 暴露**：fetch-models 新建态临时传 base_url+api_key（HTTPS 用完即弃）；编辑态 provider_id 后端解密；前端永不收明文；api_key 永不进 settings_config。
5. **settings_config vs 结构化字段冲突**：D-007 明确 toEnv 最后覆盖；UI 配置 JSON 面板提示「高级 env 覆盖上方结构化字段」。
6. **daemon bundle 部署链（task-07）**：`pnpm bundle` → backend 镜像 rebuild（daemon bundle 随 backend 镜像分发，见 memory `daemon-self-update-downgrades-manual-bundle`）。漏任一步 → 生产 daemon 仍跑旧 bundle，settings_config 不生效（AC-05 假阴性）。
7. **migration 多 head 风险**：并行变更新 migration 易撞 revision/down 分叉（见 memory `migration-chain-fragmentation-pattern`）；task-01 必须 `alembic heads` 实测单头后再下笔，down 接真实 head。
8. **JsonEditor 依赖（spike-03）**：倾向移植 cc-switch；若重依赖则自研，避免 monaco 拖慢前端构建（memory `aliyun-server-access` 2 核构建慢）。

## 文件变更清单（落地行号）

**backend**
- `backend/app/modules/llm_provider/model.py`（task-01，~line 88 后加 settings_config）
- `backend/app/modules/llm_provider/schema.py`（task-01，Create/Update/Read 三处）
- `backend/app/modules/llm_provider/router.py`（task-02，加 fetch-models 端点）
- `backend/app/modules/llm_provider/service.py`（task-02/03，fetch_models + SSRF）
- `backend/app/modules/daemon/lease/context.py`（task-04，:139-148 加 1 字段）
- `backend/migrations/versions/202607270900_*.py`（task-01，新建）
- `backend/app/modules/llm_provider/tests/`（task-12，新增/扩充）

**sillyhub-daemon**
- `sillyhub-daemon/src/types.ts`（task-05，ProviderConfig 加 settings_config?）
- `sillyhub-daemon/src/credential-injector.ts`（task-05，toEnv :98 后追加）
- `sillyhub-daemon/src/claude-settings.ts`（task-06，**新建** helper）
- `sillyhub-daemon/src/task-runner.ts`（task-06，:548 挂钩）
- `sillyhub-daemon/src/daemon.ts`（task-06，:2906 挂钩）
- `sillyhub-daemon/dist/*`（task-07，pnpm bundle 产物）
- `sillyhub-daemon/tests/`（task-13，新增）

**frontend**
- `frontend/src/components/llm-providers/model-input-with-fetch.tsx`（task-08，**新建**）
- `frontend/src/components/llm-providers/llm-provider-form.tsx`（task-09/10，:34 ROLE_ROWS / :320 details / :362 model 单元格）
- `frontend/src/components/ui/json-editor.tsx`（task-10，新建，移植或自研）
- `frontend/src/lib/api/llm-providers.ts`（task-11，加 fetchProviderModels + :232/253 payload）
- `frontend/src/__tests__/`（task-14，新增）

> 不改入口文件 cli.ts/main.ts/server.ts（task-06 挂钩 task-runner.ts/daemon.ts，非入口）。design 未提入口文件，无 path-check 阻断。

## 测试策略（对齐 local.yaml `test_strategy: module`）

| 模块 | 命令 | 命中 task |
|---|---|---|
| llm_provider | `cd backend && uv run pytest app/modules/llm_provider -q --no-cov` | task-01/02/03/04/12 |
| sillyhub-daemon | `cd sillyhub-daemon && pnpm test` | task-05/06/07/13 |
| frontend | `cd frontend && pnpm test` | task-08/09/10/11/14 |
| backend daemon/lease（context.py） | 归 llm_provider 测试范围 + `cd backend && uv run alembic upgrade head`（单头） | task-04/12 |

lint/typecheck：backend `uv run ruff check . && uv run ruff format --check . && uv run mypy app`；daemon `pnpm typecheck`；frontend `pnpm lint && pnpm typecheck`。

## 执行建议

- **Wave 1 + Wave 2 并行**（跨语言无冲突，子代理 ≤4 并发）。
- **task-06 优先人工 review**（spike-01 修正，最高风险）。
- **task-07（bundle）放 Wave 2 末尾**，且部署时与 backend 镜像 rebuild 联动。
- **AC-05 真跑 claude**（含 settings_config）放 verify 阶段端到端，不靠单测 mock。
