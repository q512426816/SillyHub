---
author: qinyi
created_at: 2026-08-17 00:02:00
scale: small
risk_level: unit-sufficient
---

# 设计文档（Design）— 本地直跑 sillyspec 文档自动同步平台

## 1. 背景

变更中心长期存在"进度到了、文档没到"的问题：平台收到 CLI 每步上行的六表进度 JSON（建占位行、step 时间线都有），但变更四件套文档（proposal/design/requirements/tasks）从未自动上行——CLI `sync()` 只推进度，`syncDocuments()`（文档推送，端点/实现全齐）仅由手动命令 `sillyspec platform sync-docs` 调用（sync.js:32 注释明写"run 流程不自动推文档"）。

根因排查（2026-08-16）：用户本地/多 agent 会话直接在主仓库跑 sillyspec（不经平台会话），产出文档全落主仓 `.sillyspec/`；daemon 自动同步推的是 daemon 本地缓存（旧 pull 快照）推不出新文档；手动"同步到服务器"按钮已修（b004038e 推主仓）但需人工点击。用户明确要求：**本地 agent 直接使用 sillyspec 工具的操作也要自动同步到平台**。

## 2. 设计目标

CLI 每步自动同步进度时，顺带把当前变更的四件套文档推上平台——生产者直连，不经 daemon，覆盖本地直跑场景。

## 3. 非目标

- 不改 daemon 自动链路（CLI 直推后 daemon 缓存不再关键，方案 A ctx-repoRoot 降级为非必要）。
- 不推四件套之外的文件（module-impact/verify-result 等仍走 daemon tar 全量链路——平台文档卡只消费四件套端点）。
- 不做变更列表 diff/增量判断（syncDocuments 本身全量推四件套，量小无需增量）。

## 4. 拆分判断

单函数改造 + 测试，small 规模（≤2 文件、单模块），走 quick --linked-changes。

## 5. 总体方案

`SyncManager.sync()`（sillyspec 仓 src/sync.js:371）在进度推送成功路径（「已同步变更」log 后、return 前）追加 `this.syncDocuments(changeName)`：

1. **best-effort**：try/catch 包裹，失败仅 `debugLog`（不 console.warn 噪音——本地未连平台等场景静默），绝不影响进度上行的返回值/流程。
2. **空防护**：syncDocuments 现有实现读四件套构造 map——四件套全缺失时（brainstorm 早期阶段可能只有 proposal）至少 proposal 存在即推；**全缺失**（quick 会话等）跳过不调端点（后端 DocumentsSyncRequest 空 map 422，属预期约束）。
3. **触发点零新增**：`triggerSync`（run/shared.js:421）每步 --done 已调 sync()，文档随进度自动上行，无新触发逻辑。
4. **平台模式不受影响**：triggerSync 平台模式（specRoot/runtimeRoot）直接 return 不走 CLI sync——平台会话内同步仍走 daemon 链路（b004038e 已修手动；会话产出在 daemon 缓存内自洽）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyspec:src/sync.js | sync() 成功路径追加 syncDocuments 调用（try/catch best-effort + 四件套全缺失跳过）。producer=sync() 进度上行成功 → 消费方=平台 POST /documents 端点（既有） |
| 修改 | sillyspec:src/__tests__/sync.test.js | 新用例：sync 成功后 documents 端点被调 / 四件套全缺失跳过 / documents 失败不影响 sync 返回值 |

## 7. 接口定义

无新接口（复用既有 POST /api/changes/{name}/documents，白名单四件套裸 map）。

## 8. 数据模型

无。

## 9. 兼容策略（brownfield）

- 未连接平台：sync() 现有早退（`_getPlatform()` falsy）不变，syncDocuments 不会被调。
- 老 SillyHub 后端（无 /documents 端点）：404 → catch → debugLog 静默，进度上行不受影响（platform-sync-docs-approval change 已在主仓部署该端点）。
- 手动 `platform sync-docs` 命令保留（幂等重推无害）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 每步 --done 多一次 HTTP 请求（频率=每步一次，量级低） | P2 | 四件套总大小 <100KB；失败静默；可接受 |
| R-02 | syncDocuments 内部 console.log 噪音（现有实现有 log） | P2 | 保持现状（与手动命令一致的输出可见性） |
| R-03 | 平台模式（specRoot）会话产出不经此链路 | P1 | 明确非目标：平台会话走 daemon 链路（手动按钮已修）；本地直跑场景全覆盖 |

## 11. 决策追踪

| 决策 | 版本 | 覆盖 |
|---|---|---|
| D-001@v1 治本=CLI 直推文档（生产者直连） | accepted（用户确认） | §5 |
| D-002@v1 daemon 自动链路改造（方案A ctx-repoRoot）降级非必要 | superseded by D-001 | §3 |
| D-003@v1 平台模式（specRoot）不走 CLI sync 保持现状 | accepted | §5.4 |

## 12. 自审（Self-Review）

- ✅ 章节齐全；清单 2 项含数据流；生命周期契约表不涉及。
- ✅ 兼容三层（未连接/老后端/手动命令保留）。
- ✅ small 规模判定：2 文件单模块无 schema/API 新增 → quick 流程。
