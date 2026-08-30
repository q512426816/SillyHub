# 验证报告 — 2026-08-29-usage-by-provider-model（用量统计细化到供应商/模型 + 会话页模型级联选择）

---
author: qinyi
created_at: 2026-08-30 21:55:00
---

## 结论

**PASS**（integration-critical 已附真实生产 Runtime Evidence：明细表落库 17 run/20 行真实数据、多模型 run 四维==明细求和全等、模型快照链路真实会话在用；相关三端测试 150 用例全绿。）

> 说明：本报告由归档前置补验（2026-08-30）完成——前一会话 verify 步骤已 --done 但报告仅落骨架（结论待填）。本次重开 step-7 全量补真实探针与结论；「任务完成度/设计一致性」两节为前次会话已填内容，经本次测试与生产数据复核成立。

## 任务完成度
task-01~14 全部完成：逐卡验收条件均有对应测试/实测证据（明细落库 4+7 用例、统计 6、inject 7、create 2、e2e 1、daemon 32+12、frontend 104），无未完成/存疑项。

补验（2026-08-30）：task-13「全链路自测」原卡未回填执行证据，本次以生产 DB 实测补齐（见 Runtime Evidence——比原口径更强的真实链路证据）；14/14 checkbox 全勾与代码事实一致。

## 设计一致性
一致（含 Grill 修订后的 R-07/R-08 语义）；执行期合理偏差 6 文件经 task review changedFiles 声明放行（caller 同步/测试 mock 补齐/收口接线）。

补验（2026-08-30）关键词逐项 grep 实证：`AgentRunModelUsage` ORM（agent/model.py）+ 迁移 20260829010000_add_agent_run_model_usage.py；`RuntimeUsageRead.by_provider`（daemon/schema.py:899）+ `_build_by_provider_sql`（daemon/runtime/service.py:1474-1511，COALESCE 去重沿用）；daemon.ts `_modelUsageRows` 明细拆行（:460）+ payload `model_usage`（:654/:3047）+ run 级 api_requests；stream-json.ts message_start 计数器（:89 注释钉死 batch 口径）+ task-runner stats 组装；前端级联候选 = provider.model → default_fallback_model → model_role_mappings 去重保序（session-config-bar.tsx:255-264）；inject_session 扩 model（session/service.py，空串跟随配置）+ 兜底模型快照级同步；lib/daemon.ts injectSession model 扩参；api-types.ts 含 by_provider/model_usage 生成物。

## 探针结果（CLI 机械预填 + 语义补验）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖（2026-08-30 补验，agent 执行）
- ✅ 供应商×模型明细表：agent_run_model_usage（ORM+迁移+UNIQUE(run_id,model) upsert）落地
- ✅ by_provider 分组统计：后端 schema+SQL、前端 runtime-card 4 处消费
- ✅ daemon 终态上报扩展：model_usage[]/api_requests（interactive）/model/api_requests（batch）双链路
- ✅ 消息流计数口径：stream-json message_start 计数器 + task-runner 组装（SDK 无现成字段的替代口径，design §2）
- ✅ 配置条四块→两块：机器/智能体块删除（session-config-bar 21 用例含布局收缩断言）
- ✅ 供应商+模型级联：候选三源去重保序+「默认」首项；injectSession(model) provisional 暂存/Codex 锁定
- ✅ llm_provider_id 仅空时填充（Grill 修订 §1.2）+ 兜底模型快照级同步（R-07/§4.2）

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/agent、backend/migrations/versions）找到 15 个测试文件
- ✅ task-02: 模块目录（backend/app/modules/daemon、frontend/src/lib、backend）找到 65 个测试文件
- ✅ task-03: 模块目录（backend/app/modules/daemon/run_sync、backend/app/modules/daemon/tests）找到 10 个测试文件
- ✅ task-04: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/tests）找到 11 个测试文件
- ✅ task-05: 模块目录（backend/app/modules/daemon/runtime、backend/app/modules/daemon/tests）找到 10 个测试文件
- ✅ task-06~08: daemon 侧 bridge/stats 测试（daemon-interactive-bridge / stats-passthrough 等 11 文件）
- ✅ task-09/10: sessions/__tests__（session-config-bar 等 5 文件）
- ✅ task-11~13: daemon tests 21/13 文件；**task-13 ⚠️ run_sync 目录递归未找到测试文件**——该 task 为人工全链路自测（非代码产出），其「测试」以生产链路实测替代（见 Runtime Evidence），且 e2e 流程有专项 test_e2e_model_usage_flow.py 兜底，非盲区
- ✅ task-14: 模块文档变更索引（multi-agent-platform 三卡条目已落，2026-08-30 归档批次 grep 核实）
- ℹ️ 集成盲区：无——除 task-13 如上说明外，路由/服务/落库链路由 test_e2e_model_usage_flow.py 走真实 HTTP 断言 DB 终值

#### 探针 4：决策追踪覆盖（2026-08-30 补验，agent 执行）

| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 方案 A 完整版明细表 | FR-01/04 | task-01~05 | agent_run_model_usage 表+迁移+upsert+by_provider SQL；生产 20 行真实数据 | ✅ 闭环 |
| D-002@v1 候选复用高级设置体系 | FR-03 | task-10 | session-config-bar.tsx:255-264 三源去重保序；21 用例 | ✅ 闭环 |
| D-003@v1 扩现有用量卡不建新页 | FR-04 | task-12 | runtime-card by_provider 分组+footnote；14 用例 | ✅ 闭环 |
| D-004@v1 配置条四块→两块 | FR-03 | task-09 | session-config-bar 块删除+布局收缩；21 用例 | ✅ 闭环 |
| R-07 兜底模型快照级同步 | FR-03 | task-11 | session/service.py default_fallback_model=model 快照 | ✅ 闭环 |
| R-08 llm_provider_id 仅空时填充 | FR-01 | task-03 | close_interactive_run 填充守卫+用例 | ✅ 闭环 |

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 4931 backend endpoints (live [scan-root 511] + artifact 4599), 0 frontend calls [scope: change-diff (16 files @ scan-root)]
- ⚠️ 1611 个后端端点前端未调用（warning 不阻断，历史存量；本变更新增/扩展端点参数均在调用面内）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录

## 测试结果（2026-08-30 补验实测，test_strategy=module 相关子集）

| 套件 | 命令 | 结果 |
|---|---|---|
| backend 专项 8 文件 | `uv run pytest app/modules/daemon/tests/test_{e2e_model_usage_flow,lease_model_usage,run_sync_model_usage,runtime_usage_by_provider,runtime_usage_service,session_usage,inject_session_model}.py app/modules/change/tests/test_usage_stats.py -q --no-cov` | **71 passed**（18.18s，0 失败） |
| sillyhub-daemon 专项 2 文件 | `pnpm exec vitest run tests/daemon-interactive-bridge.test.ts tests/stats-passthrough.test.ts` | **44 passed**（0 失败） |
| frontend 专项 2 文件 | `pnpm exec vitest run session-config-bar / runtime-card` | **35 passed**（21+14，0 失败） |

合计 **150 passed / 0 failed**；known_failures 豁免清单未动用（无命中）。

## 变更风险等级

**integration-critical**（design 无显式 risk_level 声明，仅有 scale/tier；门控判定：design 命中 daemon 终态上报扩展（daemon.ts payload）与 session inject_session 扩 model 关键词，且明细落库依赖 daemon→backend 真实链路——非纯 unit 可覆盖）。已按门禁附真实 Runtime Evidence（下节），结论保持 PASS 非 PASS WITH NOTES。

## Runtime Evidence（2026-08-30 生产库实测，postgres 容器 multi-agent-platform-postgres-1 / DB platform）

- **明细落库真实数据**：`agent_run_model_usage` 现存 **20 行 / 17 个 run / 2 个模型**——claude-fable-5[1M]（17 行，Σinput=2,812,860 / Σoutput=28,104 / Σcache_read=9,122,240 / Σapi_requests=118）+ claude-opus-4-8[1M]（3 行，173,697/15,102/555,072/7）。数据窗（join agent_runs.created_at）**2026-08-29 03:08:57 → 2026-08-30 11:52:47**——即变更合入当天起 daemon 终态上报→backend upsert 全链路持续真实运转。
- **run 四维==明细求和（多模型 run 实证）**：3 个多明细行 run 全部精确相等——run_id 1057a947（552,224==552,224 / 10,371==10,371）、257e9acf（548,980==548,980 / 10,307==10,307）、8d41732a（737,763==737,763 / 10,531==10,531）。task-13 验收口径「明细四维==run 四维」在生产数据上成立。
- **模型选择链路（task-09/10/11 端到端）**：agent_sessions.config_snapshot->>'model' 现存真实会话快照 mimo-v2.5×2、kimi-for-coding×1——前端级联选择→createSession/inject model→backend 快照落库链路真实在用。
- **不涉及**：无新 daemon 协议消息类型（payload 字段扩展）；无 lease 生命周期变更；无部署脚本/启动入口改动（migration 随 08-29 部署已生效，head 无分叉——表已在生产存在即证）。

## 技术债务

- 探针 1 design 清单文件零 TODO/FIXME/HACK 命中；无本变更引入的新债务标记。
- 既有已知项（非本变更引入，不阻断）：api parity 1611 未调用端点为历史存量 warning。

## 代码审查

- execute 期逐 task review 已过（前次会话，任务完成度节所引 6 文件偏差均经 changedFiles 声明放行）；本次补验为只读检查（verify 铁律），未发现需回 execute 的问题。
- 总体评价：实现与 design（含 Grill 修订 R-07/R-08）一致，明细表/统计/级联三子目标均有测试与生产数据双证据；质量良好。
