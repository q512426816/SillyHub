---
author: qinyi
created_at: 2026-10-25 10:08:01
generated_by: sillyspec-design-init
scale: "small"
---

# 设计文档（Design）— 2026-10-25-trajectory-source-model

## 背景

轨迹视图（2026-10-22-trajectory-view-redesign 起的三态视图）按 dsh（deepseek-harness）对照补齐「上下文 / 系统」两类行时发现结构性差距：dsh 的引擎事件里每条用户位消息原生携带 `source.kind`（真人/插件/后台通知…），且每个请求系列落系统提示词与工具快照；本平台日志层没有这两个维度——DB 实证：团队派发指令、后台通知等系统注入全部以 `user_input` channel 落库且 `metadata` 为空（agent_run_logs 仅 stdout/tool_call/user_input/stderr 四通道），前端无从区分，轨迹里全部标成「用户」行。

用户裁决：否决前端启发式（2026-10-25-trajectory-system-rows 已 reject，其两笔提交将在本变更 revert），按 dsh 机制做全套——消息来源标记（数据层盖戳）+ 请求级系统提示词/工具快照上报，跨 backend + sillyhub-daemon + frontend 三端。

## 设计目标

- 系统注入消息（主控简报 / Worker 派发 / 后台通知）在数据层携带来源标记，轨迹按标记显示「上下文」行（dsh `source.kind !== 'user' → context` 同构）。
- daemon 在轮边界上报配置面请求头快照（systemPrompt 配置段 + allowedTools + mcpServers 清单），首次与变更时落一条日志；轨迹显示「系统」行（初始系统提示词 / 系统提示词已更新 / 工具已更新，文案照 dsh）。
- 顺带修复 `submit_steps` 只落 `_agent_event` 的 metadata 透传缺陷（知识库已知坑「三层日志 metadata 丢失」）。

## 非目标

- 不回填存量历史会话的来源标记（无标记数据如实显示「用户」行，D-003）。
- 不获取引擎（Claude Code CLI）内部展开的系统提示词全文——快照是配置面口径（D-002）。
- 不在会话页聊天流渲染系统行（只进轨迹，D-011）。
- 不新建表/端点/查询链路（方案 B 已否决，D-006）。
- 不改轮次状态机、SSE 建流协议、日志读取 API 形状。

## 拆分判断

三端顺序依赖（backend 盖戳与落库 → daemon 上报 → 前端装配渲染），非可并行任务簇——但三端各自上下文可独立（backend inject/submit 链、daemon driver 链、前端装配链互不重叠），按 Wave 分三波执行：Wave1 backend（盖戳 + submit 透传 + channel 落库）、Wave2 daemon（快照采集与上报）、Wave3 frontend（装配 + 轨迹行 + revert）。非批量模式（无重复模板实例）。

## 总体方案

**Wave1 backend——来源盖戳与落库管道**
1. 注入点盖 `turn_trigger`（扩闭表三 kind，D-009）：主控简报轮（`_dispatch_inject_turn` 拼 briefing 路径）→ `team_brief`；Worker 派发首轮（`create.py` 首条 user_input 落库）→ `worker_dispatch`；后台通知（`mission_context.py` workers-done / child-wake 调 `inject_session_as_service`）→ `agent_notice`。复用 `_merged_turn_metadata` 既有合并函数。
2. `submit_steps.py` metadata 通用透传：daemon 传的 metadata 原样落 `metadata_`（现状只认 `_agent_event`），白名单约束键集防注入。
3. 新 channel `session_header` 落库（AgentRunLog.channel 字符串列，无枚举约束，落库侧仅按 channel 归类）。

**Wave2 daemon——配置面请求头快照**
1. 采集：**driver 生命周期事件采集**（Grill P1 修订）——仅在 driver `start` / `reloadWithConfig` / `restoreAndReconnect` 三处重建 spec 后采集 `{systemPrompt: state.systemPrompt 配置段, allowedTools, mcpServers 名称清单}`（driver-factory / claude-sdk-driver 既有数据点）；轮内不采集（避免 MCP discover 抖动面，R-02 一致）。mcpServers 取 `opts.mcpServers`（profile.mcpRefs 过滤后子集）的 name 键去重。
2. 变更检测：session 级缓存上次快照，字段级比较（照 dsh `headerEquals`）；首轮 → `reason: "initial"`，与缓存不等 → `reason: "change"`；相同不重复上报（D-010）。
3. 上报：经 `submitMessages` 额外提交一条 `{type: "log", channel: "session_header", content: header JSON, metadata: {reason}}`。
4. team_brief 行 content 语义（Grill P2 修订）：主控简报只进 SESSION_INJECT payload 不落库（control.py:782-784 既有注释），DB user_input 行 content 保持用户 `/team` 原文；`contentHidden=true` 折叠展开显示 `/team` 原文（如实，不隐藏）。盖戳时断言该轮 `task_wakeup`/`auto_resume_of` 为空（落库点优先级 task_wakeup > auto_resume > 显式值，简报轮由用户发送触发不冲突，测试断言防回归）。

**Wave3 frontend——装配与轨迹行**
1. `TURN_TRIGGER_META` 加三行（team_brief / worker_dispatch / agent_notice，glyph+label+contentHidden=true）；盖戳消息经既有 `classifyTurnTrigger` → `turn_trigger` 段 → 轨迹「上下文」行（链路已就位，零新装配代码）。
2. `session_header` 日志 → `logsToTurns` 装配为 `request_header` 段（带 prev 快照引用）；段不渲染进轮块流（D-011）。
3. `from-turn-views`：`request_header` 段 → `kind=system` + `meta.headerChange={initial|system|tools|system-and-tools}` 行；diff 分类前端做（prev 无 → initial；systemPrompt 变 → system；tools 变 → tools，照 dsh `inspectRequestPrompt`）。
4. `trajectory-view-model`：标签「系统」，文案「初始系统提示词 / 系统提示词已更新 / 工具已更新 / 系统提示词与工具已更新」。
5. revert 启发式代码（77ba0588b / c93aafc84：`TEAM_DISPATCH_PREFIXES` / `isTeamDispatchText` / `meta.systemBrief` 全部移除，D-004）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service/inject.py | 主控简报轮盖 `turn_trigger=team_brief`；`_merged_turn_metadata` 路径复用 |
| 修改 | backend/app/modules/daemon/session/service/control.py | `_dispatch_inject_turn` briefing 拼接处传递来源标记（数据流：producer=inject 链 → AgentRunLog.metadata_ → SSE envelope → 前端 logsToTurns → turn_trigger 段 → 轨迹上下文行） |
| 修改 | backend/app/modules/daemon/session/service/create.py | Worker 派发首轮 user_input 落库带 `turn_trigger=worker_dispatch` |
| 修改 | backend/app/modules/agent/mission_context.py | workers-done / child-wake 通知调 `inject_session_as_service` 时传 `turn_trigger=agent_notice` |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_steps.py | metadata 通用透传（白名单键集）+ `session_header` channel 归类落库（producer=daemon → submit_messages → AgentRunLog → SSE/历史 API → 前端） |
| 修改 | sillyhub-daemon/src/interactive/claude-sdk-driver.ts | 轮边界采集 header 快照 + 字段级变更比较 + 上报 session_header 日志消息 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | header 采集取数（systemPrompt 配置段 / allowedTools / mcpServers）辅助导出 |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | `TURN_TRIGGER_META` 加三行；`TurnSegment` 加 `request_header` 段类型与分类 |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | `logsToTurns` 装配 `session_header` → `request_header` 段（prev 快照链 + 会话级独立序列，见接口定义修订） |
| 修改 | frontend/src/components/daemon/session-log-sanitize.ts | `classifySessionLog` 加 `session_header` 分类分支（Grill 修订：分类函数归属地在此模块） |
| 修改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | `request_header` 段 → 系统行（meta.headerChange）；revert 启发式（TEAM_DISPATCH_PREFIXES/isTeamDispatchText/systemBrief 移除） |
| 修改 | frontend/src/components/daemon/trajectory/build-trajectory.ts | meta 类型：`systemBrief` 移除、`headerChange` 新增 |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-view-model.ts | 标签「系统」+ 四态文案（初始/系统提示词/工具/双变更）；revert 启发式分支 |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts | request_header 段用例 + revert 启发式用例改写 |
| 修改 | backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py | 主控简报轮盖 team_brief 用例（含优先级断言：该轮 task_wakeup/auto_resume 为空） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_session_inject_source_stamps.py | Worker 首轮 worker_dispatch / 通知 agent_notice / 真实输入不盖戳 / submit_steps 白名单透传用例 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/session-header-snapshot.test.ts | 快照采集（driver 生命周期事件）/ 字段级比较（initial/change/相同不报）/ 上报消息形态用例 |

## 接口定义

```ts
// daemon → backend submit_messages 新消息形态（TypeScript，daemon 侧）
interface SessionHeaderLog {
  type: "log";
  channel: "session_header";
  content: string; // header JSON 序列化
  metadata: { reason: "initial" | "change" };
}
// header JSON 载荷
interface SessionHeaderSnapshot {
  systemPrompt: string | null; // 档案配置的追加段（非引擎全文，D-002）
  allowedTools: string[];
  mcpServers: string[]; // 名称清单
}

// frontend TurnSegment 新成员
| { kind: "request_header"; id: string; header: SessionHeaderSnapshot; prev: SessionHeaderSnapshot | null; ts: number | null }

/* prev 装配算法（Grill P2 修订）：
   - logsToTurns 分组（按 run_id）前先全量扫描 session_header 日志行序列，按时间序建 prev 链；
   - request_header 段挂**会话级独立序列**（不挂具体 run 的轮——D-011「不进轮块流」的自然延伸），
     轨迹派生时按 ts 落入对应轮区间的行序；
   - headerChange 分类以**前端 prev diff 为准**（daemon reason 仅作校验/日志：daemon 重启报 initial
     但 prev 存在时不误报「初始系统提示词」，Grill P2 双信号源裁定）。 */

// TrajectoryRow.meta 新成员（build-trajectory.ts）
meta?: { ...; headerChange?: "initial" | "system" | "tools" | "system-and-tools" };

// turn_trigger 新 kind（backend metadata 值 + 前端 TURN_TRIGGER_META 键）
type TurnTriggerKind = "task_wakeup" | "auto_resume" | "shadow_chat" | "group_chat" | "schedule"
  | "team_brief" | "worker_dispatch" | "agent_notice";
```

## 生命周期契约表

不涉及生命周期契约：本变更不改 session/lease/agent_run 状态机与生命周期事件——只新增日志 channel（session_header）、metadata 键（turn_trigger 新值）与展示层段类型；`submit_messages` 为既有通道的载荷扩展。

## 数据模型

无表结构变更：`AgentRunLog.metadata_`（NulSafeJSON）复用；channel 为字符串列直接落新值。快照 JSON 走 content_redacted（<50000 字符上限内，header 远小于此）。

## 兼容策略（brownfield 必填）

- 旧 daemon / 旧 backend 组合：无盖戳、无 session_header 日志——前端按现状渲染（用户行），零行为变化。
- 新 daemon + 旧前端：session_header 日志被旧 `classifySessionLog` 归未知类——sanitize 对未知 channel 原样返回（不崩；如实口径：旧前端不渲染该行而非"映射为系统行"，Grill 修订）。
- 存量历史会话：无标记如实呈现（D-003）。
- 日志读取 API / OpenAPI schema 无形状变化（metadata 已是自由 dict 透传），无需 gen:types。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 拿不到 preset 展开的引擎系统提示词全文，配置面快照可能让用户误以为看到全文 | P1 | 行文案与文档显式标注「配置面」（档案 systemPrompt 配置段），不声称引擎全文（D-002 边界写入设计） |
| R-02 | MCP discover 时机导致同会话工具清单抖动，快照误报「工具已更新」 | P1 | 快照取 driver 启动时确定的面（allowedTools + 已注册 mcpServers 名称），轮内动态 discover 结果不入快照；实测抖动再收敛 |
| R-03 | submit_steps metadata 通用透传扩大注入面 | P1 | 白名单封闭键集落库：`turn_trigger`、chain 既有键（`source_group_id` / `source_member_id` / `source_carrier_run_id` / `chain_depth` / `sender_user_id`——plan 首步核对真实键名后冻结清单）、`reason`；白名单外丢弃并计数 |
| R-04 | 注入点遗漏（未来新增注入链路不盖戳） | P2 | 注入函数签名带 turn_trigger 形参（已备）+ 模块文档登记惯例；漏盖表现为「用户」行，可发现 |
| R-05 | 旧前端遇 session_header 未知 channel | P2 | sanitize 未知 channel 原样返回不崩；旧前端不渲染该行（如实口径，非"系统行映射"） |
| R-06 | 并行会话共享仓竞态（本会话历史实证） | P1 | 显式 pathspec 提交；收口前核对暂存面 |
| R-07 | 无长驻进程/外部资源，生命周期面不适用 | P3 | 接受：快照采集在轮边界同步完成，无后台任务 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 全文；dsh 机制全套跨三端 | 已覆盖 |
| D-002@v1 | FR-02；快照口径与 R-01 | 已覆盖 |
| D-003@v1 | FR-03；兼容策略存量段 | 已覆盖 |
| D-004@v1 | Wave3-5（revert 启发式） | 已覆盖 |
| D-005@v1 | 总体方案（复用日志通道） | 已覆盖 |
| D-006@v1 | 非目标（不建独立表） | 已覆盖（落选记录） |
| D-007@v1 | 非目标（快照必须落库） | 已覆盖（落选记录） |
| D-008@v1 | 总体方案三段式 + 原型 | 已覆盖 |
| D-009@v1 | Wave1-1（归 turn_trigger 体系） | 已覆盖 |
| D-010@v1 | Wave2-2（daemon 侧变更检测） | 已覆盖 |
| D-011@v1 | Wave3-2（系统行只进轨迹） | 已覆盖 |

无未解决决策。组合约束推演：D-003（存量如实）× D-010（只报变更）组合下，存量会话与快照缺失会话均回落「用户/无系统行」——无死锁格，语义一致（缺数据=缺行）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large——三 Wave、跨三端）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-011）
- [x] 生命周期关键词在场，已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型：登记复用+扩展（轨迹真码原型加三类新行，产物 `prototype-trajectory-source-model.html`；素材源 frontend/src/components/prototype/trajectory-redesign-view.tsx，经 `pnpm prototype:build` 编译）
- [x] 无「⚠️ 自审存疑」项
- [x] Grill 修订收纳（2026-10-25 独立评审 PASS，P1×1/P2×4/cannot_verify×1）：采集时机改「driver 生命周期事件」（start/reloadWithConfig/restoreAndReconnect，轮内不采）；prev 装配算法与会话级独立序列、headerChange 以 prev diff 为准写入接口定义；文件清单补 session-log-sanitize.ts；R-03 白名单给封闭键集；R-05 改如实口径；team_brief content 语义与优先级断言写入 Wave1/Wave2；遗留 plan 首步两查：submit_steps channel 派生点（:520 前段）、chain 既有键名核对
