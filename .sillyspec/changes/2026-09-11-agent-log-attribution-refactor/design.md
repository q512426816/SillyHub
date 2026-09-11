---
author: qinyi
created_at: 2026-09-11 23:08:16
scale: large
tier: independent
---

# 设计文档（Design）— 2026-09-11-agent-log-attribution-refactor

## 背景

本地 agent 日志上报链路（sillyspec CLI `agent-session-log.js` → `POST /api/agent-logs` →
`platform_agent_logs` → 会话/变更/quicklog 视图）在真实多窗口用法下归属大面积错配，两份实证：

1. **ctx 错配**（`docs/sillyspec/agent-log-ctx-attribution-mismatch.md`）：CLI 每次 run 把
   cwd 15 分钟窗口内**所有**活跃日志文件打上本次 --change/--quick 的 ctx（last-wins 覆盖），
   多窗口并行互相抢标——实证包括未跑过 sillyspec 的对话窗口被标变更、父子会话拆到不同变更、
   quick/change 双键并存（协议称互斥）。
2. **hub 交叉污染**（`docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md`）：
   CLI 全量重推共享留底（daemon workspace junction → 仓库 `.sillyspec` 后本地/平台共留底），
   hub 会话（daemon 派发，env `SILLYHUB_SESSION_ID` 注入）把留底里别人的条目整批挂走——pi 会话
   名下出现本地 zcode IDE 会话日志（e3d7ddfa/d4c29d95 实证）。

用户裁决（2026-09-11，AskUserQuestion 三轮）：打标=会话身份锚定；归属=同变更就挂（跨
harness 不限制）+ 无会话则 find-or-create（沿用现有自动会话）；存量=清归属列重推；不动表结构。

## 设计目标

见 requirements.md FR-01~FR-07。核心四条：

1. 一条本地日志的 ctx 只由**它所属 agent 会话自己（或其子代理）的 run** 写入（D-001）；
2. 平台按 entry ctx 解析归属：同 ctx 的平台派发会话优先挂，无主自动建会话（D-002/D-003）；
3. quick 执行可靠落到 quick 聚合会话并关联 quicklog（D-006）；
4. 与本会话无关的日志不再出现在任何平台会话（D-007）。

## 非目标

- 不做 M:N 归属链接表 / 行级多挂（D-005 用户否决）；
- 不做 harness↔provider 一致性拦截（D-009 用户否决——跨 harness 同变更挂接是需求）；
- 不改 daemon（junction 共享留底在本方案下无害化：各会话只更新 own 条目，留底退化为本地调试产物）；
- 不改 frontend（数据变正确，展示组件全复用；无 API schema 变化，无需 gen:types）；
- 不动 liveness states 链路（daemon 独立通道，按 log_path 操作行，与归属列无关）；
- 不做日志内容解析增强、daemon 日志白名单（R-01 既有遗留）。

## 拆分判断

单一变更承载：归属语义是 CLI↔平台两端共振的协议级行为，拆开会出现两端口径不一致的过渡态
（旧 CLI 全量推送 × 新平台 ctx-owner 解析会把别人的条目解析到错误的 owner）。协议 v1.2 字段
零新增（语义收敛），两端可独立发布（见兼容策略），但设计/验收必须一体。

## 总体方案

### Phase 1 — sillyspec CLI：会话身份锚定 + 推送收敛 + 互斥落地

**锚定器（D-001/D-008）**——`agent-session-log.js` 新增 own 集合解析，per harness：

| harness | 锚定规则 | 子代理识别 |
|---|---|---|
| claude-code | env `CLAUDE_SESSION_ID` → `<projectDir>/<sessionId>.jsonl` 精确；env 缺席回退 project 目录（cwd 直算 slug）内最新活跃 jsonl（DG-07） | 无子代理概念（不扩） |
| zcode | 读 `~/.zcode/cli/db/db.sqlite`（node:sqlite `DatabaseSync`，`file:...?mode=ro` 只读）：`session` 表 `directory==cwd AND parent_id IS NULL AND id NOT LIKE 'sess_subagent_agent_%'` 按 `time_updated` desc 取最新主会话。**directory 存 Windows 反斜杠原样，比较复用既有 normCwd/cwdsMatch 归一**（DG-16） | `parent_id == 主会话 id` 的全部行（**不比 directory**——worktree TaskCard 子代理 directory=worktree 路径≠仓库根，按父链收录并绕过 cwd 等值探测过滤）；rollout 文件名映射 `model-io-sess_<id去sess_前缀>.jsonl` |
| pi | safePath 目录直算（目录名即 cwd 会话，天然锚定） | 无 |
| deepseek-dsh | 同 pi 构：safePath 目录直算（DG-06 补） | 无 |
| codex | rollout 首行 `session_meta.cwd == cwd` 的最新主文件（现窄扫逻辑保留、只取最新一条） | 无 |
| cursor / opencode（loose 档） | 不锚定、不打标、不推送——仅维持本地留底探测（DG-06 明示） | — |
| env 覆盖 | `SILLYSPEC_AGENT_LOG` 指定文件视为 own | — |

own 命中的文件**豁免** `MAX_PER_HARNESS` 探测上限：常规探测（cwd 等值过滤 + 上限裁剪）照旧，
锚定命中的主会话/子代理文件若被上限挤出则定向补收进 detected（DG-17——同 cwd 并发 >6 个
zcode 文件时 own 不得漏推）。

zcode 回退链：node:sqlite 导入失败 / 库缺失 / 查询异常 → 退化为「最新活跃主会话文件」锚定
（rollout 目录 `model-io-sess_<uuid>.jsonl` 最新 mtime），**subagent 不打标**（宁缺毋滥，
D-001）；回退发生时 `SILLYSPEC_DEBUG_AGENT_LOG=1` 输出一行原因。

**打标与登记**：`recordAgentLogInvocation` 合并循环仅对 `detected ∩ own` 条目写
ctx/invocations/last_command；非 own 条目只在留底中保留探测事实（size/mtime），ctx 不写不动。
互斥**双向**落地（D-006@v2）：quick run 对 own 条目置 `quick_id` 且清空 `change_key`，
change run 置 `change_key` 且清空 `quick_id`（单向清会留下镜像 bug——change 日志漏进旧
quick 会话，Grill DG-01）。

**推送收敛（D-007）**：push payload `entries = 留底条目 ∩ own`（按 log_path 过滤）；留底
继续记全部探测（本地 `sillyspec agent-log` 可见性不变）。hub_session_id 取值不变。

**测试**：锚定命中（各 harness fixture）/ 锚定失败不打标 / 子代理链命中与回退缺省 /
quick 清 change_key / push 只含 own / 留底含非 own（现有测试改造 + 新增）。

### Phase 2 — backend：ctx-owner 归属解析（platform_sync）

`_upsert_agent_log_entries_once` 归属段重写（service.py:1346-1452）：

1. **hub 分支**（hub_session_id 有效）：语义不变——本批 entries 全挂 hub 会话 + 时间重叠
   过滤保留。**「全挂=只挂 own」是 CLI 升级后的前提**（DG-13：旧 CLI 全量推送过渡期污染
   继续，见兼容策略/R-04）+ `_bind_entry_ctx` 照旧落 quick/change 绑定（= 登记「hub 会话 ↔
   ctx」）。
2. **无 hub 分支**：分组键统一 `ctx = quick_id or change_key or ''`（D-006@v2 修正，原
   change 优先）；空 ctx 组维持现状单桶（`{harness}|` 键 + harness 标题，D-003 边界）。
   非空 ctx 组解析 owner（**两级 find**，DG-05——bind 是 best-effort 可失败，仅 links 一级
   会复现重复建会话）：
   - **find 第一级（links）**：quick_id → `quicklog_session_links WHERE workspace_id AND
     ql_id`；change_key → `changes WHERE workspace_id AND change_key` JOIN
     `change_session_links`（links 存 change_id FK 非文本键，DG-10 join 链）；均再 JOIN
     `agent_sessions`（deleted_at IS NULL）取 `last_active_at` 最新——候选天然含平台派发
     会话（hub 分支 bind 登记过）与自动会话（D-002 同变更就挂、跨 harness 不限制）；
   - **find 第二级（聚合键兜底）**：links 未命中时按
     `agent_sessions WHERE origin='tool_report' AND workspace_id AND aggregation_key='{ctx}'
     AND deleted_at IS NULL` 取 `last_active_at` 最新（对齐原设计 D-006 容错：bind 失败
     遗漏的组由聚合键收敛）；
   - 命中（任一级）→ 组内 entries `agent_session_id = owner.id`，刷 owner
     `last_active_at`（不改 status，生命周期契约不变）；两级均未命中 → find-or-create
     `origin=tool_report`（`aggregation_key="{ctx}"`、`title="本地 · {quick 短码或变更名}"`、
     provider 映射不变 D-007 原决策，D-003）；
   - 组级 `_bind_entry_ctx` 不变（quick 优先已正确）。
3. R7 重试（IntegrityError rollback 重跑一轮）保留。

**测试**：quick 优先分组 / hub 登记后本地同 ctx 挂 hub（跨 harness）/ 无主 find-or-create /
多 owner 取最近活跃 / 空 ctx 单桶不变 / 时间过滤回归 / 幂等重推。

### Phase 3 — backend：存量清理数据迁移（D-004@v2）

Alembic 数据迁移 `20260912xxxxxx_agent_log_attribution_reset.py`，四条清理：

- `UPDATE platform_agent_logs SET agent_session_id = NULL`（行保留，重推重建归属）；
- `UPDATE agent_sessions SET deleted_at = now() WHERE origin='tool_report' AND deleted_at IS NULL`
  （旧格式 `{harness}|{ctx}` 聚合键不再复用，防僵尸会话）；
- `DELETE FROM change_session_links`（全表清空——links 无来源列，错配时代的 hub 污染行
  [service.py hub bind] 与合法行不可区分，全清重建）；
- `DELETE FROM quicklog_session_links`（同上）；
- downgrade：no-op（数据可重建，说明写入 docstring）。

**执行时机（DG-03，与 backend 代码发布解耦）**：backend 代码先行发布（兼容旧 CLI）→
CLI 升级 → 以一次性运维动作执行本迁移；迁移脚本不随 backend 发布自动前滚。

无 schema 变更（D-005）。

### Phase 4 — 协议文档与发布顺序

sillyspec 仓 `docs/platform-agent-log-protocol.md`：§1 推送范围改「own 条目」、§3 增补
per-harness 锚定规则与回退、会话化上下文段落改写（双向互斥语义、ctx-owner 平台行为、
**无 ctx 的 run（如 status）对 own 条目保留原 ctx 的 keep-prev 语义显式写明**——复核 P3-③）。
发布顺序（DG-03 口径）：backend 先（旧 CLI 全量推送在新平台下：非 own 条目按各自 ctx
解析，错配收敛不扩大）→ CLI 升级 → Phase 3 数据迁移一次性执行。

## 文件变更清单

<!-- 跨仓协议：sillyspec 仓库根 = C:/Users/qinyi/IdeaProjects/sillyspec（local.yaml repos.sillyspec），下段路径相对该仓根 -->

### sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/agent-session-log.js | 锚定器 + own 过滤 + 双向互斥 + push 收敛 |
| 修改 | docs/platform-agent-log-protocol.md | §1/§3/会话化上下文改写 |
| 修改 | test/agent-session-log.test.mjs | 锚定/own/互斥/推送范围用例 |

### main 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/service.py | 归属段重写（ctx-owner 两级解析 + quick 优先分组） |
| 新增 | NEW:backend/migrations/versions/20260912050000_agent_log_attribution_reset.py | D-004@v2 数据迁移（四条清理，downgrade no-op） |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_push.py | 既有断言更新（分组/归属语义变化回归） |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_agent_log_attribution.py | 归属解析新用例（两级 find/跨 harness 挂接/旧双键过渡期等） |

## 接口定义

CLI 新增（sillyspec 仓 `agent-session-log.js`）：

```js
/** 解析本 run 的 own 日志文件集合（锚定主会话 + 子代理）；识别失败返回仅含回退主文件或空集。 */
function resolveOwnLogPaths({ cwdCandidates, env, homeDir, now, windowMs }): Set<string>
```

平台 `upsert_agent_log_entries` 签名不变；内部归属行为按 Phase 2。HTTP API schema 零变化。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 工具上报（own，无 hub） | SillySpec CLI | backend ctx-owner 解析 | workspace(token 派生)、harness、ctx(quick 优先) | owner 命中→挂接+刷 last_active_at；无主→find-or-create `tool_report`(pending)；均不改 status |
| 工具上报（own，有 hub） | SillySpec CLI | backend hub 分支 | hub_session_id、workspace 校验、时间重叠过滤 | 目标会话 status 不变，仅 entries 挂接 + ctx 绑定登记 |
| 懒激活/继续对话/结束/断连/重开 | 既有链路（2026-08-23-agent-activity-sessions §7） | 不变 | 不变 | 与原设计完全同构（本变更不触碰） |

## 数据模型

无 schema 变更。数据级变化：`agent_sessions.aggregation_key` 新值域 `"{ctx}"`（空 ctx 桶
维持 `"{harness}|"`）；`title` 新格式「本地 · {ctx}」；一次性数据迁移见 Phase 3。

## 兼容策略（brownfield 必填）

- **旧 CLI × 新 backend（过渡期）**：全量推送下非 own 条目按各自持久化 ctx 解析 owner
  （entry ctx 保留原值不追新的既有语义），错配不新增；旧双键条目按 quick 优先归组（与原
  change 优先不同，但旧双键本身是 bug 产物，归 quick 更符合语义）。
- **新 CLI × 旧 backend**：own-only 推送直接消除 hub 污染与抢标（主要收益先行生效），
  ctx-owner 聚合待 backend 升级。
- **回退路径**：CLI 回退=恢复全量推送（行为回到现状）；backend 回退=归属解析回 harness|ctx
  分组（数据迁移 downgrade no-op，重推自愈）。API/表结构全程不变。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | zcode 同 cwd 多主会话并发跑 sillyspec，锚定取 time_updated 最新——旧窗口 run 可能错认到新窗口 | P2 | 错配有界（同 cwd 同 harness 且时间并发）；debug 日志暴露锚定结果；后续可加进程树/env 增强锚定 |
| R-02 | node:sqlite 在用户实际 Node 上不可用（<22.13 或构建裁剪） | P2 | 回退链（D-008）只锚主会话；engines 已 >=22.13.0；本机 v24 实证可用 |
| R-03 | 同 ctx 多会话时行向最近活跃 owner 漂移（自动会话被平台会话吸收后清空） | P3 | 设计意图内（同工作线程聚合）；quicklog/change links 双向可见，无信息丢失 |
| R-04 | 过渡期（旧 CLI 未升级）残余错配继续入库（hub 分支「全挂=own」前提未成立，DG-13） | P2 | Phase 3 迁移在 CLI 升级后执行清账；过渡期错配由迁移一次性清除，不依赖自然收敛 |
| R-05 | zcode db.sqlite 被独占写锁导致读取失败 | P3 | mode=ro + WAL 惯例可并发读；失败走回退链；不重试不加锁 |
| R-06 | daemon junction 共享留底的 top-10 淘汰风险 | P3 | 淘汰只威胁非 own 条目（不参与推送，无影响）；own 条目在每次 run 的 merge 中被更新 last_seen_at 恒回到列表头部（DG-18 修正理由，结论 P3 不变）；如需提升 MAX_ENTRIES 留 execute 决策 |
| R-07 | 存量 tool_report 会话软删后，用户已打开的列表/详情失效 | P3 | 未上线可清（CLAUDE.md 规则 11）；软删可逆 |

UI 原型：跳过——纯数据归属修复，无界面布局/结构/流程变化（frontend 零文件改动）。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | Phase 1 锚定器 + 打标收敛；FR-01 | 已覆盖 |
| D-002@v1 | Phase 2.2 ctx-owner 解析（两级 find）；FR-03 | 已覆盖 |
| D-003@v1 | Phase 2.2 find-or-create + 聚合键/标题；FR-03 | 已覆盖 |
| D-004@v2 | Phase 3 数据迁移（四条清理 + 执行时机）；FR-05 | 已覆盖 |
| D-005@v1 | 数据模型节（无 schema 变更）；非目标 | 已覆盖 |
| D-006@v2 | Phase 1 双向互斥 + Phase 2 分组 quick 优先；FR-02 | 已覆盖 |
| D-007@v1 | Phase 1 推送收敛；FR-04/FR-06 | 已覆盖 |
| D-008@v1 | Phase 1 zcode 锚定实现与回退链 | 已覆盖 |
| D-009@v1 | 非目标（harness 拦截不做） | 已覆盖（否决记录） |
| D-010@v1 | 非目标（保守修补不采用） | 已覆盖（否决记录） |
| D-011@v1 | 非目标（登记表不采用） | 已覆盖（否决记录） |

Grill 修正（design-grill，源=审查子代理 2026-09-11）：DG-01→D-006@v2 双向互斥；
DG-04→D-004@v2 links 全清（用户裁决）；DG-03/05/06/07/13/16/17/18 已按推荐修正并入
对应章节（发布顺序解耦/两级 find/dsh 补行/claude 回退/升级后前提/normCwd/own 豁免
探测上限/R-06 理由）；DG-02（requirements.md 缺失）由 Step 8 生成规范文件解决。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale/tier）
- [x] 引用所有当前版本决策（D-001~D-003@v1、D-004@v2、D-005@v1、D-006@v2、D-007@v1、D-008@v1、D-009~D-011@v1）
- [x] 涉及会话生命周期 → 生命周期契约表已填（归属事件三行，其余声明同构不动）
- [x] UI 原型分级核对：跳过原因已写入风险登记节末尾（无前端文件改动）
- [x] 不确定的问题标注：「⚠️ 自审存疑」无——zcode env 无会话 id、node:sqlite 可用性、
      links 表结构均已源码/运行时实证；codex/pi 锚定规则沿用既有探测代码路径（run/command.js
      与 agent-session-log.js 已读），无未验证断言。
