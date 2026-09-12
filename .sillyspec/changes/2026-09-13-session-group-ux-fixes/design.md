---
author: qinyi
created_at: 2026-09-13 00:26:21
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-13-session-group-ux-fixes

## 背景

用户实测反馈三项会话/群聊体验缺陷：

1. **输入框草稿跨会话串台**：在一个会话输入未发送的内容，切到另一个会话输入框仍出现。代码查证：真会话草稿按 sessionId 隔离且七宿主均 key 重挂载，隔离正确；唯预会话（sessionId=null）草稿用固定键 `__pre__`（`turn-state.ts:304`），跨工作区/跨机器入口共享，任一入口的未发送内容必然带入下一入口——与用户「a 会话内容带到 b 会话」实测吻合（D-001）。
2. **移动端输入框高度拖拽手柄无响应**：`handleHeightDragStart` 只绑 `onMouseDown` + window `mousemove/mouseup`，触摸屏不触发；CSS `touch-none` 禁了默认手势但 JS 层无触摸监听（D-002）。`session-input-bar.tsx` 与 `group-chat-panel.tsx` 两处同款副本。
3. **群聊跨工作区不可见**：群挂项目 A（`project_id`），项目 A 关联工作区 D/F（`PpmProjectWorkspace` M:N），用户期望 D/F 都能看到群聊；现前端过滤只匹配群聊直接 `workspace_id`（`session-list-panel.tsx:964-970`、`mobile-session-list.tsx:250-256`），挂 D 的群在 F 不可见（D-003）。

## 设计目标

- FR-1 预会话草稿按入口（workspaceId+runtimeId）隔离，不同入口互不串台；真会话草稿隔离行为零回归（含测试锁定）。
- FR-2 移动端触摸拖拽手柄可实时调节输入框高度（44-480px 钳制）、双击恢复默认、localStorage 持久化；桌面鼠标行为零回归。
- FR-3 群聊在其直接归属工作区**和**关联项目的全部工作区均可见（用户须为群成员，成员过滤前置不动）；打开群的访问控制（群成员校验）零变化。

## 非目标

- 不重构真会话草稿系统（隔离理论正确，未证实存在缺陷，方案 C 已否决——YAGNI）。
- 不改群聊访问控制/权限模型（仅放宽列表可见性）。
- 不改群聊建群时的 workspace_id 推导逻辑（建群仍锚定一个直接工作区）。
- 不做旧 `__pre__` 草稿数据迁移（项目未上线，数据可清空）。
- 不处理 `archived` 过滤参数的 None 显式全量口径（既有已知限制，另行处理）。

## 拆分判断

三项缺陷同属会话/群聊 UX 域，共享前端测试环境与验证流程，合为一个变更；三模块改动面互不重叠（草稿=turn-state+panel、拖拽=input-bar+group-panel、可见性=backend+两列表），plan 阶段按 Wave 并行组织。无批量模式特征。

## 总体方案

### Wave 1（三项并行，无依赖）

**模块一：预会话草稿键细分（FR-1）**

- `turn-state.ts`：`sessionDraftLsKey` 的预会话分支从固定 `__pre__` 改为 `__pre__:<workspaceId|'-'>:<runtimeId>`。实现形态：`readSessionDraft` / `writeSessionDraft` 增加第三参 `preScope?: string | null`（入口标识串），键函数按 `sessionId ?? (preScope ? \`__pre__:${preScope}\` : "__pre__")` 组装——未传 preScope 的旧调用点回落共享键，行为兼容。
- `session-panel-page.tsx`：草稿恢复/写入两处 effect 传入 `preContext ? \`${preContext.workspaceId ?? '-'}:${preContext.runtimeId}\` : null`（真会话 sessionId 非空时 preScope 不参与键）。
- `session-panel-dialog.tsx`（口径统一）：dialog 预会话态（view.sessionId 为空）传 workspaceId 维度 scope（`workspaceId ?? '-'`，dialog 无 runtime 维度），真会话同 page 不参与。
- 测试：真会话切换时序锁定（A 输入→切 B→B 显示自有草稿、A 草稿不受污染）+ 预会话两入口隔离断言。

**模块二：拖拽 Pointer Events（FR-2）**

- `session-input-bar.tsx`（501-526,651）与 `group-chat-panel.tsx`（1688-1711,2771）：`handleHeightDragStart` 改 `React.PointerEvent`，`onMouseDown` → `onPointerDown`，window 监听 `mousemove/mouseup` → `pointermove/pointerup`。**不用 setPointerCapture**（对齐 `panel-resizer.tsx:5-20` 真实先例：window 级监听保证拖出元素仍收事件，且 jsdom 无 setPointerCapture 实现——测试同路径）。坐标取 `e.clientY`（PointerEvent 同名字段，触摸/鼠标统一）。
- `touch-none` 类名保留（阻止浏览器滚动/缩放接管触摸）。
- 双击恢复（`onDoubleClick`）、44-480px 钳制、`INPUT_HEIGHT_LS_KEY` 持久化全部不动。
- 测试：`session-input-bar-height.test.tsx` 断言从 `fireEvent.mouseDown/mouseMove/mouseUp` 迁 `fireEvent.pointerDown/pointerMove/pointerUp`；jsdom 的 `fireEvent.pointer*` 丢 `clientY` 坐标，用 `createEvent + defineProperty` 补坐标（先例 `floating-session-host.test.tsx:711`、`explorer-page.test.tsx`）。`group-chat-panel` 无现成高度拖拽测试，新增同款断言。

**模块三：后端可见工作区集合（FR-3 后半前置）**

- `backend/app/modules/daemon/group/service/crud.py` 新增辅助函数（如 `get_project_workspace_map(session, project_ids) -> dict[uuid, list[uuid]]`）：一次 `SELECT ppm_project_id, workspace_id FROM ppm_project_workspace WHERE ppm_project_id IN (...)` 批量查关联（无 N+1）。
- `backend/app/modules/daemon/group/router.py`（**GroupChatListItemRead 实际定义处 :62，扩展字段落 router 层是既有惯例——`online_member_ids` 先例 :84**）：`GroupChatListItemRead` 加 `visible_workspace_ids: list[uuid.UUID] = []`；列表端点在 `_to_list_item`（:189）组装后统一填充：`visible_workspace_ids = 去重([直接 workspace_id] ∪ 该群项目关联集)`。**不在 crud.list_groups 里组装**——service 返回 `list[GroupChatRead]`，值经 `model_validate` 进不了 router DTO，照 online_member_ids 先例在端点层填（Grill 审查修正）。
- `GroupChatRead` 本体（agent/schema.py）不加字段——仅列表消费需要，detail 消费点无工作区过滤场景。
- 后端测试：群挂项目（关联 D/F、群 workspace_id=D）→ 列表项 `visible_workspace_ids` 含 D 与 F；无项目群 = `[workspace_id]`；非成员不可见不变。

### Wave 2（依赖 Wave 1 模块三）

- `pnpm gen:types` 重生成 `api-types.ts` + 提交 `backend/openapi.json`（CLAUDE.md 规则 21）。
- `session-list-panel.tsx`（964-970）与 `mobile-session-list.tsx`（250-256）过滤改 `(g.visible_workspace_ids ?? [g.workspace_id]).includes(当前工作区)`——`??` 兜底 react-query 旧缓存（字段未到时不闪隐）。
- 前端测试：过滤断言覆盖「群挂 D、项目关联 D/F → workspace scope D 与 F 均含该群」「无 project 群仅直接归属可见」。

### Wave 3：验证收口

- 三模块相关面测试全绿 + lint；对照本设计验收（verify 阶段展开）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-panel/turn-state.ts | 草稿键函数支持 preScope 入口标识（FR-1） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 草稿两 effect 传 preScope（FR-1） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 预会话态传 preScope（workspace 维度，无 runtime）（FR-1） |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | 拖拽改 Pointer Events（FR-2） |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 同款拖拽副本同步改（FR-2） |
| 修改 | backend/app/modules/daemon/group/service/crud.py | 新增 get_project_workspace_map 批量查辅助（FR-3） |
| 修改 | backend/app/modules/daemon/group/router.py | GroupChatListItemRead 加字段 + 端点组装 visible_workspace_ids（FR-3，Grill 修正落点） |
| 重新生成 | frontend/src/lib/api-types.ts | gen:types（FR-3，含 openapi.json） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | workspace scope 过滤改集合判定（FR-3；同文件 __tests__ 群分区 mock 补新字段） |
| 修改 | frontend/src/components/mobile/mobile-session-list.tsx | 同款过滤改集合判定（FR-3；mobile-session-list.test.tsx mock 补字段） |
| 测试 | frontend session-panel 系测试 | FR-1 时序/入口隔离断言（session-panel-prompt.test 等挂载 harness 扩展） |
| 测试 | frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx | FR-2 pointer 事件迁移 + 补坐标方案 |
| 测试 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | FR-2 高度拖拽新增断言（无现成测试） |
| 测试 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | FR-3 群列表 mock 补 visible_workspace_ids |
| 测试 | frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | FR-3 群列表 mock 补字段 |
| 测试 | NEW:backend/tests/modules/daemon/test_group_visible_workspaces.py | FR-3 visible_workspace_ids 组装三断言 |

## 接口定义

```python
# turn-state.ts（TS）
function sessionDraftLsKey(sessionId: string | null, preScope?: string | null): string;
function readSessionDraft(sessionId: string | null, preScope?: string | null): string;
function writeSessionDraft(sessionId: string | null, draft: string, preScope?: string | null): void;
// preScope 形如 "<workspaceId|'-'>:<runtimeId>"；sessionId 非空时 preScope 被忽略

# router.py（新增字段，GroupChatListItemRead 定义处）
class GroupChatListItemRead(GroupChatRead):
    visible_workspace_ids: list[uuid.UUID] = []  # 直接归属 ∪ 项目关联，去重；默认空=旧缓存兜底语义

# crud.py（新增辅助）
async def get_project_workspace_map(
    session: AsyncSession, project_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:  # 单条 IN 批量查 PpmProjectWorkspace
```

Producer→consumer 数据流：router 列表端点调 crud 辅助取项目→工作区映射 → `_to_list_item` 组装后统一填 `visible_workspace_ids` → `GET /api/daemon/group-chats` 响应 → gen:types 生成 → 桌面/移动列表过滤消费。

## 生命周期契约表

不适用 lifecycle contract——本变更不涉及 session/lease/agent_run/daemon 生命周期事件、状态迁移、claim/heartbeat 契约（草稿键与拖拽为纯前端行为；群列表字段为读路径扩展，零状态变化）。

## 数据模型

无 schema/表结构变更——`visible_workspace_ids` 为响应组装字段（运行时计算，不落库）；`PpmProjectWorkspace` 既有表只读消费。

## 兼容策略（brownfield 必填）

- `readSessionDraft`/`writeSessionDraft` 第三参可选，未传的既有调用点（dialog 预会话若无 scope）回落 `__pre__` 共享键，行为不变。
- `visible_workspace_ids` 前端消费用 `?? [g.workspace_id]` 兜底，react-query 旧缓存（无新字段）不过滤闪隐，退化为现状行为。
- 后端字段纯增量，旧客户端忽略未知字段，无破坏。
- 旧 `__pre__` localStorage 键遗留不清理（无迁移价值，用户下次输入自然写入新键）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 真会话串台另有未定位根因（理论隔离正确但用户实测遇串） | P2 | FR-1 时序测试锁定行为；若用户复现仍现在真会话间，凭测试基线再定位（decisions D-001 evidence 留痕） |
| R-02 | Pointer Events 在老旧移动浏览器兼容 | P3 | Pointer Events 基线 2019+ 全绿（caniuse），项目内 panel-resizer/悬浮球已生产使用同 API |
| R-06 | jsdom 测试双坑：无 setPointerCapture 实现 + fireEvent.pointer* 丢 clientY 坐标 | P2 | 实现不用 setPointerCapture（window 级监听先例）；测试用 createEvent+defineProperty 补坐标（floating-session-host.test.tsx:711 方案）——Grill 审查补登 |
| R-03 | gen:types 暴露无关旧测试债（mock 缺字段） | P3 | 按惯例顺手补字段修复，不回退手写（CLAUDE.md 规则 21） |
| R-04 | 批量 PpmProjectWorkspace 查询在大群量下的性能 | P3 | 单条 IN 查询 + 索引（复合主键）；群量级远低于阈值，无分页需求（现状全量列表） |
| R-05 | UI 原型跳过（分级依据：三项均行为级修复，无布局/结构/流程变化） | — | 用户已在 Step 5 确认设计，原型无对照需求 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 预会话草稿键细分 | FR-1 / Wave 1 模块一 | accepted |
| D-002@v2 拖拽改 Pointer Events（不用 setPointerCapture，Grill 修正） | FR-2 / Wave 1 模块二 | accepted |
| D-003@v1 后端返回可见工作区集合 | FR-3 / Wave 1 模块三 + Wave 2 | accepted |
| D-004@v1 整体方案选 A | 全局组织 | accepted |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-004）
- [x] 生命周期关键词命中（session/daemon 词频）→ 已写豁免短语（读路径/纯前端行为，无状态迁移）
- [x] UI 原型分级核对：跳过，依据记入 R-05
- [x] 无自审存疑项——R-01 为已知残余风险且已有应对路径
