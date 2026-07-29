# 验证报告（Verify Result）— 模型调用失败可见性完整修复（claude code 会话）

**变更**：2026-07-29-model-error-visibility
**结论**：✅ **PASS WITH NOTES**

---

## 结论

**PASS WITH NOTES**。功能验收 8 核心标准全达标，9 决策闭环，3 端契约 gen:types 一致，不影响 PPM，brownfield 兜底。3 端命中模块测试全绿（backend 1034 + frontend 1178 + daemon 2057）。后端写/读/SSE 三路径均有专用 pytest（14 测，app/modules/daemon/tests/ co-located）。部署关键风险（migration）已在真实运行栈验证 apply + alembic head 干净。已知债：前端 normalize.test.ts task-08 覆盖 + 全链路 live e2e（deferred）。

## 任务完成度

12/12 = 100%（详见 step3/step5 核验）。task-01~12 交付物全部落地 main，逐项验收标准功能达标。

## 设计一致性

对照 design.md（唯一 truth source）5 探针：未实现标记 0；设计关键词全覆盖；决策追踪 9/9 闭环；API 契约对账无 missing/unused；测试覆盖 ⚠️ 后端写路径缺专用测试（见技术债务）。

## 探针结果

- **未实现标记扫描**：✅ 变更文件 0 个 TODO/FIXME/HACK/XXX
- **关键词覆盖**：✅ quota_exceeded(12)/rate_limited(11)/auth_failed(20)/RunErrorItem(7)/重发(14)/切换供应商(7)/error_detail(23) 全命中
- **测试覆盖**：✅ 后端写/读/SSE 三路径有专用 pytest（test_close_interactive_run_model_error 6 + test_session_runs_endpoint 8 = 14 测，app/modules/daemon/tests/ co-located）；daemon classifier/stream-json/hub-client 137 测；frontend RunErrorItem 32 测 + 集成。⚠️ 仅 normalize.test.ts 未覆盖 task-08 error 逻辑（见技术债务 1）
- **决策追踪覆盖**：✅ D-001~009@v1 全下游覆盖，无 unresolved/superseded
- **API 契约对账**：✅ 后端 `/daemon`+`/sessions/{session_id}/runs` ↔ 前端 `listSessionRuns`；SessionRunRead schema×3；无 missing/unused

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1（仅 claude 归类） | FR-01 | task-01,02 | classifier.ts agent 分发 + 25 测 | PASS |
| D-002@v1（错误项+failed） | FR-03 | task-09,10 | run-error-item.tsx 32 测 + 会话页标红 | PASS |
| D-003@v1（细分类型+hint） | FR-01 | task-01,02 | 8 枚举 + ERROR_INFO hint | PASS |
| D-004@v1（actions） | FR-03 | task-09,10 | 重发/切换/详情回调 + retryable 门控 | PASS |
| D-005@v1（三端协议） | FR-01 | task-01 | ModelError 三端同构 + gen:types | PASS |
| D-006@v1（429 quota vs rate） | FR-01 | task-01,02 | 双 type + classifier 区分（25 测） | PASS |
| D-007@v1（JSON 列） | FR-02 | task-05 | error_detail 列 + migration 真实 PG apply | PASS |
| D-008@v1（Non-Goals 边界） | FR-04 | task-11 | 不改 GLM token/不回填/不自动恢复 | PASS |
| D-009@v1（error_code vs detail 正交） | FR-02 | task-05,06 | 两列正交不互覆 | PASS |

## 测试结果

| 模块 | 命令 | 结果 |
|---|---|---|
| backend daemon+agent | `cd backend && uv run pytest app/modules/daemon app/modules/agent -q --no-cov` | ✅ **1034 passed**（315.5s，exit 0） |
| frontend | `cd frontend && pnpm test` | ✅ **119 文件 / 1178 测试全绿**（exit 0，36.8s） |
| sillyhub-daemon | `cd sillyhub-daemon && pnpm test` | ✅ **2057 passed**（2 个 spec-sync tar 测试超时 = 3 套并发负载下 Windows 文件系统打满；隔离重跑 2 文件 30 测全过 31.8s，确认 flaky 非本变更引入——两文件零引用 model-error 代码） |

**lint**：backend ruff All checks passed + mypy 5 文件 Success no issues；daemon tsc --noEmit 干净；frontend tsc --noEmit 干净。

## 技术债务

> **更正（verify 探针修正）**：初次探针 grep `backend/tests/` 误判后端无测试；实际后端写/读/SSE 三路径**均有专用 pytest 且全过**（位于 `backend/app/modules/daemon/tests/`，模块内 co-located，非顶层 backend/tests/）：
> - `test_close_interactive_run_model_error.py`（6 测）：error_detail 写入 + 与 error_code 正交 + 字段可选 + 无 error 兜底 None。
> - `test_session_runs_endpoint.py`（8 测）：GET runs 返 error_detail + 空列表 + 401/404 鉴权 + **SSE run_error 事件**（failed turn 触发 / completed 不触发 / 无 error_detail 不触发）。
> - 合计 **14 passed**。故后端测试债**远小于初判**，仅余下列前端 + e2e 项。

1. **前端 normalize 测试债（deferred）**：normalize.test.ts 未覆盖 task-08 error 逻辑（buildErrorLogItem / :352 ASSISTANT 误判修正 / brownfield 兜底）+ R-02（NOISE 不吞 error）。run-error-item.test.tsx 32 测已覆盖组件层。
   → **deferred**：archive 后走 `sillyspec run quick` 补 normalize.test.ts task-08 覆盖。
2. **全链路 live e2e（task-11 第 3 项）**：触发真实模型失败→会话页 RunErrorItem。GLM 额度 2026-07-29 10:26 已重置恢复，design §10 约定改用无效凭证注入 auth_failed / mock 429。→ **deferred**：post-deploy 手动验收。
3. **switch provider 用 window.location**：非 useRouter（测试需 next/navigation mock）。功能正常，风格优化项。

## 变更风险等级

**risk_level 由 design.md frontmatter 显式声明 = `contract-required`（覆盖关键词判级）**。

**理由（留痕可审计）**：本变更是**加性 + 向后兼容**改造，关键词命中 daemon/session/migration 但真实风险级低于 integration-critical：
1. 跨进程传输 = notifyRunResult 加**可选 error 字段**；旧 daemon 不传 → backend error_detail=None（零回归，向后兼容）。
2. migration = 加 nullable JSON 列 error_detail（无数据迁移、非破坏），**已在真实运行栈验证 apply + alembic head 干净 + backend healthy**（部署启动路径风险已消除）。
3. session/lease 状态机**未改**（run→failed 转换本就存在，仅附加 error_detail）；daemon spawn 路径**未改**（仅在 turn 收尾加 classify）。
4. 关键风险 = 三端 ModelError 契约一致性，已由 **gen:types 强制（非手写）+ 分层单测（daemon 137 / frontend 124）+ 读端点 live** 验证。
5. frontend 渲染 brownfield 安全（无 errorDetail 行为不变）。

## Runtime Evidence（真实运行栈验证）

部署 backend+frontend 镜像 rebuild + restart 后，真实本地栈（docker compose -f deploy/docker-compose.yml）验证：

- **backend 健康启动**：`curl /api/health` → **200**（migration apply 后正常启动，无 crash-loop）。
- **migration 真实 apply（部署关键证据）**：`psql \d agent_runs` → **error_detail | json** 列存在（变更前只有 error_code）。
- **alembic 链干净**：`alembic current` → **202607291100 (head)**，无多 head、无断裂。
- **读端点 live**：`GET /api/daemon/sessions/{id}/runs` → **HTTP 200**，返回数组含 `status / error_code / error_detail / exit_code` 字段；旧 failed run `error_detail=null`（brownfield 正确，新 daemon 才会填充）。
- **daemon 写路径**：notifyRunResult error 字段 + classify 由 137 单测覆盖（含真实 claude 错误文本输入：429/[1310]/API Error/auth/timeout 各 type）；backend 接收写入由 close_interactive_run 代码实现（缺专用 pytest，见技术债务 1）。
- **前端渲染**：RunErrorItem + normalize error 类由 124 前端测试覆盖（mock 后端 error_detail 链路）。
- **失败模式排除**：backend 启动无 crash-loop；migration 无多 head（对比 [[migration-chain-fragmentation-pattern]] 风险已排除）；openapi 343 paths/411 schemas gen:types 一致。

## 代码审查

总体评价：实现质量高。亮点：(1) 三端 ModelError 协议 gen:types 强制同构，杜绝手写类型漂移；(2) classifier 纯函数 + 8 类关键词优先级（429 quota 先于 rate），25 测覆盖边界；(3) brownfield 兜底完善（无 errorDetail 不崩 + 失败兜底「运行失败（无详情）」）；(4) NOISE 折叠 R-02 明确不吞 error 项。遗留：后端写路径测试债（技术债务 1）+ 全链路 e2e（技术债务 2），均 deferred 不阻断功能上线价值。
