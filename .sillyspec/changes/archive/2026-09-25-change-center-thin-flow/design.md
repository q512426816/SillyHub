---
author: qinyi
created_at: 2026-09-25 06:51:40
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-25-change-center-thin-flow

## 背景

SillySpec CLI 已完成 quick 流程退役与「轻量变更」（thin，用户定名 D-002@v1）转正：`flow.mode` 缺省 thin、`run quick` 仅作存量收尾通道（sillyspec 仓 2026-09-25-thin-default-flip 归档；CLI 3.30.0）。上游前置修复（2026-09-25-thin-platform-args，commit 41b3490d）已解决四缺口：flow 族消费 `--spec-root`/`--spec-dir`（经 resolvePlatformSpecDir）、`ProgressManager({specDir: specBase})` 锚定同根、空目录预建放行、变更名白名单（拒 `..`/路径分隔/`default`/`quick-<hex8>`）。

平台变更中心现状与新流程全面脱节，且三子代理核对（2026-09-25，本会话）实证三个硬缺口：

1. **会话绑定断链**：`backend/app/modules/change/binding.py:72-79` 的 `extract_spec_bindings` 只识别 `sillyspec run` token 序列；而 stage 派发会话的变更绑定**唯一**依靠该命令解析通道（派发链 `backend/app/modules/agent/placement.py:535-596` 全程不写 change_session_links）。agent 跑 `sillyspec flow start --change X` 产出零绑定 → thin 派发会话在变更详情「关联会话」不可见。
2. **阶段回洗（两条路径）**：thin 变更在 sillyspec.db 全程 `current_stage='scan'/status='active'`（CLI 红线：进度落 flow-state.yaml 不落 DB），归档一键翻 `archived/archive`。路径A：daemon run_sync 在 run 完成后回调 `sync_stage_status`（backend/app/modules/daemon/run_sync/service/stage_team.py:124-129 → backend/app/modules/change/dispatch.py:1784-1807）会把 'scan' 回写进平台行并污染 stages JSON；路径B：CLI progress 每次上行经 `backend/app/modules/platform_sync/service.py:997-998`（`_sync_change_stage_status`）直接覆盖平台 current_stage——早于且独立于派发。quick 今天免疫纯因名字错位（CLI 行名 `quick-<hex>` vs 平台键 `<日期>-<slug>-<hex6>`，sync 必然 miss 跳过），thin 对齐名字后免疫消失。
3. **平台参数形态**：派发 prompt 的 `platform_args`（backend/app/modules/agent/service.py:1526-1530，`--spec-root/--runtime-root/--workspace-id`）——3.30.0 起 flow 已消费 `--spec-root`，现有形态**可原样沿用**（`--workspace-id` 静默忽略无害，triggerSync 走独立凭据链）。

另核对出：`_infer_change_type`/`_infer_current_stage` 不认识 flow-state.yaml（CLI 侧自建 thin 目录会被错标 brainstorm）；flow 链路变更名零校验（上游已加白名单，平台入口需自查防穿越）；前端七处硬编码触点不加 thin 会裸显英文 "thin" 或渲染全灰管线；三处 quick 文案仍指路已退役命令。

## 设计目标

1. 变更中心接入轻量变更：quick 类型新变更分流至 `thin` 辅助阶段，派发 agent 执行 `flow start → 干活 → flow done` 2 调用协议（含清晰度门过门格式与断点续语义的 prompt 指引）。
2. thin 派发会话与变更正确绑定（binding 认 flow 命令族）。
3. thin 变更平台阶段全程稳定显示「轻量变更」，不被 sillyspec.db 的 'scan' 停留态回洗（两条路径双守卫），归档终态正确翻转。
4. quick 存量软退役：存量变更可继续收尾（QUICK 全链保留），quicklog 面板与文案标注「存量」，新工作指路轻量变更。
5. 配置与文档同步：CLAUDE.md 流程指引、sillyspec:quick 技能、模块文档/changelog、工具坑留档。

## 非目标

- **不做** thin 进行中状态的细粒度展示（flow-state.yaml 六子步进度/tier 升厚标记）——P2 另立变更；本变更在归档前阶段停留显示属可接受。
- **不动** quicklog 全链读侧（双源查询/对账/用量/会话门户/@提及/蒸馏源 "quick"）、`bind_quick_id`/`ql-` 校验、platform_sync quicklog 推送端点、daemon 的 quick-* guard.json 逻辑——全部存量通道保留。
- **不做** change_type 标签改名（"quick"→其他）：分类标签与阶段解耦（backend/app/modules/agent/service.py:1544 仅作 prompt 上下文；reparse 推断只在 DB 值为 None 时覆盖，backend/app/modules/change/service.py:2693-2695）。
- **不做** 表结构/OpenAPI 契约变更：current_stage/change_type 全链自由字符串（backend/app/modules/change/schema.py:81-119 无 Literal；frontend/src/lib/api-types.ts 多处 `string | null`），新增 "thin" 值零迁移、无需 pnpm gen:types。
- **不改** watcher 事件通道（POST /api/changes/{name}/events，v2 语义 + 在途 v3 原地演进，互不冲突）；scope-audit 对实名变更走既有 change 模式天然支持。
- **不动** quick-chat（会话聊天功能，与 sillyspec quick 无关）。

## 拆分判断

单一变更，不拆分：三工作流（后端核心/前端视觉/配置文档）共享「thin 阶段语义 + 双守卫谓词 + 存量退役口径」三组一致概念，拆分会产生跨变更的语义对齐成本；总规模约 30 文件、无 3+ 可独立交付模块、无批量模式特征（非「模板×数据」）。非 MASTER.md 场景。

## 总体方案

### Phase 1 — 后端核心（阶段模型/派发/绑定/守卫）

**Wave 1 阶段模型与派发**：`StageEnum` 加 `THIN = "thin"`，`spec_auxiliary_stages()` 返回 `[QUICK, THIN]`（生产代码零消费已核实——backend/app/modules/change/model.py:65-72 定义与测试外无消费方；TRANSITIONS/STAGE_ORDER 不加，跑完即终态对齐 QUICK 先例与知识库状态机约定）。`STAGE_AGENT_CONFIG` 加 `"thin"` 条目（`prompt_template="thin.md"`、`phase="Thin"`、`requires_worktree=False`、`read_only=False`——与 quick 同款，走 daemon-client 写码）。新增 `backend/app/modules/change/prompts/thin.md`：2 调用协议 prompt（详见接口定义节）。

**Wave 2 分流与绑定**：`backend/app/modules/change_writer/service.py:132` 与 `backend/app/modules/change_writer/proxy.py:349` 的分流改 `initial_stage = "thin" if change_type == "quick" else "brainstorm"`。`backend/app/modules/change/binding.py` 扩展识别 flow 命令族。`backend/app/modules/change/service.py:2556-2598` `_stage_group_order` 把 thin 排进已知序（quick 之后）。

**Wave 3 双守卫与入口防线**：
- 守卫 A（backend/app/modules/change/dispatch.py `sync_stage_status`，:1784 一带）：SELECT 已取 status（:1721）——当平台 `change.current_stage == "thin"` 且 DB 行 `status != 'archived'` 时，跳过 current_stage 回写与 `stages['scan']` JSON 块写入（仅更新 last_dispatch/时间戳类字段）；DB 行 `status == 'archived'` 时放行既有归档翻转链（三源并集第②源 status='archived' 捞起，backend/app/modules/change/service.py:221-243）。
- 守卫 B（backend/app/modules/platform_sync/service.py:997-998 `_sync_change_stage_status`）：同一谓词——CLI 权威 current_stage='scan' 不覆盖平台 'thin'；status='archived' 放行。
- 入口白名单：`backend/app/modules/change/dispatch.py` 派发入口对 current_stage=='thin' 的变更校验 change_key（`^[A-Za-z0-9_.\-]+$` 且非 `default`、非 `^quick-[0-9a-f]{8}$`、不含 `..` 段），非法即拒绝派发（上游 3.30.0 已有同款校验，平台入口自查为纵深防御——防旧版 CLI 与穿越名）。
- parser：`backend/app/modules/change/parser.py:728-749` `_infer_current_stage` 增规则——变更目录含 `flow-state.yaml` → "thin"（优先于 proposal/design→brainstorm 推断）。

### Phase 2 — 前端（桌面 + 移动双端）

**Wave 4 thin 视觉与交互**：徽章/标签/筛选项/说明卡全量落位（显示名「轻量变更」，D-002@v1）：`STAGE_KIND.thin` 品牌紫阶 + `STAGE_LABELS.thin="轻量变更"`（quick 改「快速任务（存量）」琥珀）；STAGE_OPTIONS 加「轻量变更」可筛（桌面+移动两份副本同步——与 quick 不可筛不同，thin 是主力辅助流）；详情页 thin 说明卡（桌面 change-stage-actions 新分支、移动 mobile-change-detail 补同款——现状无 quick/thin 分支）；概览卡 `BYPASS_BADGES.thin` + 两处硬编码旁路判断（frontend/src/components/workspace/changes-overview-card.tsx:229、:268）加 thin。形态对照 prototype-change-center-thin-flow.html（A/B 两面）。

**Wave 5 quick 存量标注**：quicklog tab 计数改「存量 · N」；空态文案换退役指引（frontend/src/components/changes/quicklog-table.tsx:346 + 移动副本 frontend/src/app/m/workspaces/[id]/changes/page.tsx:873，两处现状仍指路 `sillyspec quick`）；quick 说明卡文案改「已退役·存量收尾」；统计卡/副标题口径同步。形态对照原型 C 面。

### Phase 3 — 配置文档与测试收口（Wave 6）

CLAUDE.md 规则 4 改指轻量变更、规则 19 quick 条目标注存量；`.zcode/skills/sillyspec-quick/SKILL.md` 加退役横幅与轻量变更用法段（上游技能模板未跟上 thin，本地先补——工具缺口已在上游代码修复，留档引用）；模块文档/changelog 四件同步；测试收口（见文件清单测试行）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/model.py | StageEnum 加 THIN="thin"；spec_auxiliary_stages() 返回 [QUICK, THIN]（TRANSITIONS/STAGE_ORDER 不动） |
| 修改 | backend/app/modules/change/dispatch.py | ①STAGE_AGENT_CONFIG 加 "thin" 条目；②sync_stage_status 守卫 A（thin 且 DB 非 archived 时跳过 current_stage/stages 回写，archived 放行）；③派发入口 change_key 白名单校验（thin 变更专用） |
| 新增 | NEW:backend/app/modules/change/prompts/thin.md | 轻量变更派发 prompt：flow start（--input 多行过门格式）→ 填槽 → flow done（断点续/fail-closed 语义）；platform_args 沿用现有形态 |
| 修改 | backend/app/modules/change/binding.py | extract_spec_bindings 识别 sillyspec flow start\|done\|amend-draft --change <名>（quick 跳过规则原样保留）；数据流：agent bash 命令（daemon run_sync submit_commit.py:329 调用）→ SpecCommandBinding(kind="change") → bind_session_to_change → change_session_links（消费方：变更详情「关联会话」） |
| 修改 | backend/app/modules/change/parser.py | _infer_current_stage 增 flow-state.yaml 在场 → "thin" 规则 |
| 修改 | backend/app/modules/change/tests/test_parser.py | parser flow-state 推断用例（thin 优先于 brainstorm 推断/非 thin 目录不受影响） |
| 修改 | backend/app/modules/change/service.py | _stage_group_order 加 thin 排序位（quick 后） |
| 修改 | backend/app/modules/change_writer/service.py | initial_stage 分流 quick→"thin"（change_type 标签不动）；数据流：classify_change_type → Change.current_stage/stages JSON 初值 → API 自由字符串 → 前端徽章映射（消费方 STAGE_KIND/STAGE_LABELS） |
| 修改 | backend/app/modules/change_writer/proxy.py | 同款分流（proxy 写入口，:349） |
| 修改 | backend/app/modules/platform_sync/service.py | _sync_change_stage_status 守卫 B（:997 一带，同一谓词：CLI current_stage='scan' 不覆盖平台 'thin'；status='archived' 放行）。注意：该文件有在途变更（2026-09-25-observation-events-v3）的未提交 hunks——execute 按 hunk 隔离提交 |
| 新增 | NEW:backend/app/modules/change/tests/test_thin_stage.py | thin 阶段族测试：STAGE_AGENT_CONFIG thin 条目/白名单四态（合法/`..`/`default`/`quick-<hex8>`）/守卫 A 三态（thin×active 不回写含 stages JSON 断言、thin×archived 放行、主线阶段不受影响） |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_thin_stage_guard.py | 守卫 B 三态 + archived 翻转走三源并集 + watcher 事件归属两前提对账（change_name 与平台 change_key 逐字一致、workspace 归属一致） |
| 修改 | backend/app/modules/change/tests/test_dispatch.py | 补 thin 配置断言（对齐既有 quick 断言形态 :52-59） |
| 修改 | backend/app/modules/change/tests/test_spec_binding.py | 补 flow start/done/amend-draft 三命令绑定用例 + run quick 跳过回归保留 |
| 修改 | backend/tests/modules/change/test_dispatch_stage_config.py | `len(STAGE_AGENT_CONFIG) == 6` 改 7（:14-16）+ thin 条目断言 |
| 修改 | backend/app/modules/change/tests/test_step_progress.py | D-003@v1 排序契约变更断言更新（辅助阶段 quick→thin→未知进已知序） |
| 修改 | backend/app/modules/change_writer/tests/test_classifier.py | 分流映射断言更新（quick→initial_stage="thin"，D-003 同轮披露） |
| 修改 | frontend/src/components/changes/__tests__/quicklog-table.test.tsx | 空态退役文案断言更新 |
| 修改 | frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx | thin 说明卡与 quick 退役文案断言更新 |
| 修改 | frontend/src/components/changes/change-step-badge.tsx | STAGE_KIND.thin（品牌紫阶）/ STAGE_LABELS.thin="轻量变更" / STAGE_LABELS.quick 加「存量」后缀（:28-48） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | STAGE_OPTIONS 加「轻量变更」（:81-88）；quicklog tab 计数徽标「存量 · N」（:66）；副标题口径（:595-599） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | STATUS_BADGE.thin = 轻量变更（:72-79，防标题裸显 "thin"） |
| 修改 | frontend/src/components/changes/detail/change-stage-actions.tsx | thin 分支只读说明卡（对齐 quick 卡形态 :129-143，两段式协议+命令+断点续提示）；quick 卡文案改「已退役·存量收尾」（:139 现指路 sillyspec run quick） |
| 修改 | frontend/src/components/changes/detail/change-stage-header.tsx | WORKFLOW_STAGE_LABELS 加 thin="轻量变更"（供 change-step-timeline 组标题复用防裸显；主管线渲染 indexOf<0 不受影响） |
| 修改 | frontend/src/components/workspace/changes-overview-card.tsx | BYPASS_BADGES.thin（:72-75）+ 两处旁路判断加 thin（:229、:268——不加则 thin 渲染全灰主管线无徽标） |
| 修改 | frontend/src/components/changes/quicklog-table.tsx | 空态文案换退役指引（:346 现指路 sillyspec quick）+ 表头存量标注 |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 移动端 STAGE_OPTIONS 副本加「轻量变更」（:121-128）；tab 徽标「存量 · N」（:114）；空态文案（:873） |
| 修改 | frontend/src/components/mobile/mobile-change-detail.tsx | 补 thin 说明卡分支（:498-608 现状无 quick/thin 分支，thin 落通用「无可审批事项」卡） |
| 修改 | frontend/src/components/workspace/stats-row.tsx | 第四统计卡「快速修复」加存量口径标注（:96-101） |
| 修改 | .claude/CLAUDE.md | 规则 4 小修复改指轻量变更（flow start/flow done）；规则 19 quick/QUICKLOG 条目标注存量 |
| 修改 | .zcode/skills/sillyspec-quick/SKILL.md | 顶部退役横幅（存量收尾 only，文案对齐 CLI run/stage.js:371）+ 轻量变更用法段（上游技能模板未跟上，本地先补） |
| 新增 | NEW:docs/sillyspec/finished/thin-flow-quick-retirement.md | 工具坑留档：flow 平台参数面四缺口（--spec-dir 崩溃/预建拒收/指针不读/PM 锚定脱钩）+ 名称零校验——上游 3.30.0 已代码修复（引用本会话核对结论），按规则 15 归档到 finished/ |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.md | change/change_writer/platform_sync 模块文档补 thin 阶段语义与双守卫 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md | 后端 changelog 条目 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.md | changes 组件族 thin 视觉与存量标注 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md | 前端 changelog 条目 |

## 接口定义

```python
# backend/app/modules/change/model.py
class StageEnum(str, Enum):
    ...
    QUICK = "quick"
    THIN = "thin"          # 新增：轻量变更辅助阶段（D-001@v1）

    @classmethod
    def spec_auxiliary_stages(cls) -> list["StageEnum"]:
        return [cls.QUICK, cls.THIN]

# backend/app/modules/change/dispatch.py
STAGE_AGENT_CONFIG["thin"] = StageAgentConfig(
    enabled=True, prompt_template="thin.md", phase="Thin",
    requires_worktree=False, read_only=False,
    description="Thin flow: 2-call protocol (flow start → work → flow done).",
)

_THIN_CHANGE_KEY_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")  # 纵深防御白名单
def _validate_thin_change_key(change_key: str) -> None:
    """非法（含路径段/`..`/default/quick-<hex8>）→ raise AgentRunError，拒绝派发。"""

# backend/app/modules/change/binding.py — extract_spec_bindings 扩展
# 段内 token 序列 sillyspec flow (start|done|amend-draft) 后找 --change <名>
# → SpecCommandBinding(kind="change", change_key=名)；名 == "default" 跳过（同 run 族规则）

# 守卫谓词（dispatch.py sync_stage_status 与 platform_sync/service.py _sync_change_stage_status 同规则）：
# if 平台 change.current_stage == "thin":
#     if db_row.status == "archived": 放行归档翻转（既有链路不动）
#     else: 跳过 current_stage 回写与 stages JSON 写入（仅时间戳/last_dispatch 类更新）
# else: 现状行为不变
```

**thin.md 模板契约**（变量 `{{change_key}}/{{change_title}}/{{platform_args}}/{{workspace_id}}`，渲染链 backend/app/modules/agent/service.py:1539-1549）：

- 步骤 1：`sillyspec flow start --change {{change_key}}{{platform_args}} --input "<多行：动机一行 + 独立节头行「成功标准：」+ 每行一条 - <标准>>"` ——**过门格式硬约束**：单行内联「成功标准：xxx」恒被清晰度门拒（CLI extractSuccessCriteria 节头正则要求独立行；列表回退要求 markdown 列表行）。
- 步骤 2：干活：改代码+写测试；顺手填 design.md 四节 AGENT 槽与 requirements 测试绑定槽（每处至少一行，「不适用：<理由>」也算答）。
- 步骤 3：`sillyspec flow done --change {{change_key}}{{platform_args}}` ——写明：中间态 exit 1 属正常（空槽拒收/实测失败自动升厚），修复后重跑同命令断点续；实测失败=整单失败 fail-closed。
- 预期：flow done 归档后变更自动转入归档区，无需再跑其它命令。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| thin agent 执行 flow start/done（bash 命令） | daemon 会话 | backend（daemon run_sync submit_commit 解析） | command 含 `sillyspec flow <sub> --change <名>` | change_session_links 插入（会话↔变更绑定，无平台状态变化） |
| thin 派发 run 完成 | daemon lease complete | backend stage_team → sync_stage_status（守卫 A） | change_id, run_id, sillyspec.db 行（current_stage/status） | 平台 stage 恒 'thin'（active 期）；DB archived → 平台翻归档 |
| CLI progress 上行 | sillyspec CLI | backend platform_sync `_sync_change_stage_status`（守卫 B） | changes 六表 JSON + X-SillySpec-Base-Ts | 同上：thin 恒稳，archived 放行翻转 |
| CLI watcher 事件 | sillyspec CLI watcher | backend POST /api/changes/{name}/events | ts/kind/stage/detail/provisional=true | 无状态变化（只展示；本变更不动该通道，仅对账测试） |

## 数据模型

无表结构/字段变更：`changes.current_stage` 为自由字符串列（backend/app/modules/change/model.py:180-183，仅 location 有 CHECK）；OpenAPI 契约中 current_stage/change_type 均为 `str | None`/`string` 自由串，新增 "thin" 值零迁移、前端 api-types 无需重新生成（子代理核对第 10 项全链核实）。

## 兼容策略（brownfield 必填）

- **存量 quick 全保留**：QUICK 阶段派发（quick.md）、quicklog 读写、bind_quick_id、蒸馏源 "quick"、daemon guard.json——一行不动；存量在途 quick 变更继续旧链路收尾（CLAUDE.md 规则 19：不清存量）。
- **未产生 thin 变更的环境零行为变化**：双守卫谓词仅在平台 `current_stage=='thin'` 时生效（该值只由新分流产生）；白名单仅校验 thin 变更；主线五阶段与 quick 的 sync 行为逐字不变。
- **回退路径**：change_writer 分流改回 `"quick"` 一行即回退新变更入口；已产生的 thin 变更走守卫语义不受影响（阶段停留显示，可人工归档）。
- **不改变的 API/表**：quicklog 4 端点、agent-logs 契约（quick_id 字段）、事件通道 v2/v3、scope-audit 模式面。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 双守卫漏守任一条 → thin 阶段被洗回 'scan'/stages JSON 出现幽灵 scan 组 | P0 | 两处守卫同一谓词；test_thin_stage.py + test_thin_stage_guard.py 分别锁 A/B 路径，含 stages JSON 不污染断言与 archived 放行断言 |
| R-02 | 前端触点漏改 → 裸显英文 "thin"/概览卡全灰管线/移动端无说明卡 | P1 | 核对清单 7 处触点全部列入文件清单；verify 按清单逐项对照 |
| R-03 | platform_sync/service.py 与在途变更（2026-09-25-observation-events-v3）未提交 hunks 同文件 | P1 | execute 按 hunk 隔离提交（仅提交守卫 B 相关行块，git add 精确路径+行块，不夹带他人 WIP）；提交前 git diff 复核 |
| R-04 | daemon 机器 sillyspec < 3.30.0 → flow 忽略 --spec-root，变更落 agent cwd/.sillyspec | P1 | thin.md 沿用现有 platform_args（3.30.0 已消费）；部署核验清单加 `sillyspec --version` ≥3.30.0 检查（verify 步骤执行） |
| R-05 | agent 把成功标准写成单行内联 → 清晰度门 exit 2 卡死首轮 | P1 | thin.md 步骤 1 给出过门格式硬样例（独立节头行+列表行）；prompt 明示「单行内联会被拒」 |
| R-06 | 事件归属错位（change_name≠change_key 或 workspace 不符 → 403/孤儿事件） | P2 | test_thin_stage_guard.py 对账两前提；platform_sync 归属日志复核 |
| R-07 | 无长驻进程/外部资源，生命周期面不适用（显式留痕） | — | 本变更不引入任何进程/句柄/子进程；派发会话生命周期走既有 daemon lease 链 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Phase 1/2；文件清单 model.py/dispatch.py/thin.md/writer 两处/前端同列展示相关行；FR-01~FR-05 | 已覆盖 |
| D-002@v1 | 前端全部文案位（STAGE_LABELS/STATUS_BADGE/筛选项/说明卡/CLAUDE.md/skills）；FR-05~FR-07 | 已覆盖 |

**多裁定组合推演**（D-001 thin 阶段 × 守卫谓词 × 归档翻转）：

| 平台阶段 | sillyspec.db 状态 | 行为 | 死锁？ |
|---|---|---|---|
| thin | active / current_stage=scan | 守卫 A/B 均跳过回写 → 恒显「轻量变更」 | 否 |
| thin | archived（flow done 后） | 守卫放行 → 归档翻转（三源并集第②源 status='archived'） | 否 |
| quick（存量） | 任意（名字错位天然 miss） | 现状不变 | 否 |
| 主线五阶段 | 任意 | 守卫不触发，现状回写 | 否 |

无死锁格；无未解决决策。剩余风险见 R-01~R-06。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（D-001/D-002，含组合推演）
- [x] 生命周期契约表（涉及 daemon/agent_run/state transition 关键词，四事件矩阵已列）
- [x] UI 原型分级核对（组件级变化 → 已生成 prototype-change-center-thin-flow.html 三面）
- [x] 无「⚠️ 自审存疑」项（三个硬缺口与七触点均有子代理实证行号支撑；上游契约以 3.30.0 实测回执为准）
