---
author: qinyi
created_at: 2026-08-28 02:52:40
scale: large
change: 2026-08-28-session-ppm-task-binding
prototype: prototype-session-ppm-task-binding.html
---

# 设计文档（Design）— 会话关联 PPM 任务/问题 + 发起团队预选修复

## 1. 背景

平台会话已支持关联 SillySpec 变更（`change_session_links`）与快速修复（`quicklog_session_links`），创建会话时自动注入【变更上下文】前导（2026-08-25-session-spec-binding / 2026-08-26-session-input-mention 建成的 M:N 绑定基座）。PPM 模块（已上线）的「个人进行中计划任务」（PlanTask）与「问题清单」（PpmProblemList）目前与会话零关联：用户在会话里讨论一个 PPM 任务时，agent 拿不到任务的描述、状态、附件，需要在任务系统和会话之间来回复制粘贴。

附带问题（bug）：PPM 项目页「发起团队」按钮点击后仅注入页面上下文（`page_context.ppm_project`），派团队弹层不自动打开、项目/关联工作区不预选、objective 为空——预选链路在 UI 层完全未实现（`team-trigger-popover.tsx` 无 `defaultProjectId` prop，`projectId` state 初始空串，`floating-session-host.tsx` 的 workspaceId 恒 null）。

## 2. 设计目标

1. 会话可绑定 PPM 计划任务/问题（M:N），创建会话即注入任务**全部文字字段**（标题/描述/状态/项目/模块/责任人/周期）与**附件**（file_urls 真附件注入，失败降级文字清单）。
2. 任务/问题侧提供「发起会话」入口（自动解析项目关联工作区，默认第一个）与「关联会话」卡片（本人前 3 条预览 + 深链打开会话）。
3. 会话输入框 @联想新增「PPM 任务 / PPM 问题」分组（默认进行中，可切全部）；会话列表「关联」筛选支持 ppm 维度。
4. 修复「发起团队」：PPM 项目页点击后预会话自动打开派团队弹层，自动选中该项目 + 第一个关联工作区 + 预填 objective。

## 3. 非目标

- 不重构现有 change/quicklog 绑定链路（方案 C 已否决，见 D-005）。
- 不改变 PPM 任务/问题的状态机与既有 API 行为。
- 不做移动端（`app/m/`）的 PPM 任务会话入口与 @联想适配（桌面优先；移动端会话面板读到 ppm 绑定信息时不报错即可）。
- 不做任务/问题状态变化对会话的联动通知。

## 4. 拆分判断

单变更承载：绑定基座 + 注入 + 前端入口是同一条数据链路的四段（表→注入→展示→触发），拆开会互相阻塞验收（表没有则注入无源，注入没有则卡片空转）；「发起团队」修复与绑定基座共享 floating-session store 与预会话链路，合入同变更但独立 Phase（Phase 5），互不阻塞。

## 5. 总体方案

### Phase 1 · 后端绑定基座

- 新表 `ppm_item_session_links`（`backend/app/modules/ppm/common/session_binding.py`）：`kind`（`plan_task`|`problem`）+ `item_id`（**软关联无 FK**，对齐 quicklog 模式——PPM 数据可由同步写入，硬 FK 会拦删除）+ `session_id`（FK CASCADE）+ `workspace_id`（可空），唯一约束 `(kind, item_id, session_id)`。
- `bind_session_to_ppm_item(db, *, workspace_id, kind, item_id, session_id)`：upsert 幂等（savepoint 自吞，对齐 `change/binding.py` 风格）。
- 读取端点：新增 `backend/app/modules/ppm/common/router.py` → `GET /api/ppm/item-sessions?kind=&item_id=`，返回结构与 `GET /changes/{id}/sessions` 同构（links JOIN agent_sessions，含本人标识）。
- 工作区解析：`item.project_id → ppm_project_workspace` 按 **workspace_id 升序（UUID 字典序）取第一个**（表无时间列且现有查询无 ORDER BY，必须显式定死排序键，前端预选与后端 link 写入同键，D-004@v2）→ 写入 link.workspace_id 与 AgentSession.workspace_id（若创建时未显式指定）；无关联工作区则两者留空，不阻塞（D-004）。

### Phase 2 · 上下文注入（文字 + 附件）

- `build_ppm_item_context_preamble(db, kind, item_id, *, attachment_lines)`（`daemon/session/context.py`）：读 PlanTask/PpmProblemList 全字段，拼【PPM 任务上下文】/【PPM 问题上下文】前导，插入点与【变更上下文】一致（`dispatch_prompt` 前导段）。
- 附件（D-006）：`materialize_ppm_attachments(...)`（`daemon/session/service.py` 内私有方法 + `ppm/common/session_binding.py` 提供读 File 元数据 helper）。执行序：**先物化（含 storage 读 IO，在会话写事务外完成）→ 前导组装消费物化输出的 attachment_lines**（与 create_session 现有"前导组装提前到写事务外"不变量一致）：
  1. `file_urls` → `File` 行批量校验存活（软删/缺失剔除）+ **访问控制**：按 `FileService._can_access` 同口径校验（上传者本人/平台管理员可读，D-007）——无权条目不物化；
  2. 有权且 provider=claude 且（与用户手动附件合并后）满足 图≤5/文≤5 时：读 storage bytes → 写 session attachment storage（`storage.store_bytes`，flush-only 新路径；不复用 `upload()`——其自带 commit 与 PIL/大小校验，源文件已在 file 中心过上传校验不重复）→ 物化 `SessionAttachment` 行（session_id 直接回填、user_id=创建者）→ 并入现有 `attachment_ids` 组装链路（标记行/多模态块/落盘全复用，daemon 零改动；交付闸门沿用 assemble 的 8MB 内联/回拉/disk 决策）；
  3. 超限、provider≠claude、读取失败、File 已删、无权访问的条目 → 降级为前导文字清单：有权条目列「文件名 + `GET /api/file/{file_id}` 链接」（该端点自带 inline 预览契约）；无权条目仅列文件名并注明「无权访问」。

### Phase 3 · 前端任务侧入口 + 会话卡片

- 新组件 `frontend/src/components/ppm/ppm-item-sessions-card.tsx`（kind+itemId 泛化，复用 `change-sessions-card.tsx` 结构：listItemSessions，本人前 3 条预览，点击深链 `?session=` 打开会话面板）。
- 入口挂载：`task-plans/page.tsx`（个人任务视图行操作）+ `workbench-task-table.tsx`（我的任务行操作）+ `problem-list/_problem-drawer.tsx`（详情底部）。「发起会话」触发通道：`floating-session.ts` store 新增 `pendingPpmItem` 挂起位（`requestNewSession` 会清空 preContext，不能走 preContext 直传）——入口写入 `pendingPpmItem{kind,id}` 并 `requestNewSession(pageContext)`，`floating-session-host.tsx` 打开预会话时从 store 读取挂起位构造 `preContext.ppmItem`，同时前端 `listProjectWorkspaces(item.project_id)` 按 workspace_id 升序解析第一个填 `workspaceId`（解析不到则不带）。
- 首句创建：`SessionPreContext` 扩展 `ppmItem`，`handlePreSessionSend` 随 createSession 上送 `ppm_item_kind`/`ppm_item_id`（与 changeId/quickId 并列）。

### Phase 4 · @联想 + 会话列表筛选

- `session-mention-sources.ts` 的 `useMentionSources` 新增两分组：「PPM 任务」「PPM 问题」，按当前用户拉取：任务走 `listPersonalPlanTasks(status=["进行中"])`（该端点 status 为多值 Query，已核实）；问题走问题列表 `duty_user_id=me`（对齐 PPM「我的任务」口径，唯一查询参数，D 口径拍死）；默认进行中，提供切全部开关（D-002）；条目标注项目名。PPM 分组不按会话 workspace 过滤（PPM 实体与工作区是软关联多对多），但**沿用现有 atEnabled 门控**（无 workspace 会话 @ 联想整体禁用，PPM 分组亦禁用，不单独放开）。
- `session-mention-popover.tsx` 渲染新分组；选中 → `pendingMentions.ppmItem` → 首句提交绑定（创建路径）或 `injectSession` 携带 `bind_ppm_item_kind/bind_ppm_item_id`（追问路径，只写 link 不注入前导——对齐 quicklog 行为）。
- `session-list-panel.tsx` 关联筛选 Select 新增选项（value 编码 `ppm:plan_task:<uuid>` / `ppm:problem:<uuid>`）→ `listAgentSessions` 透传。

### Phase 5 · 「发起团队」预选修复

- `floating-session.ts`：`requestNewSession` 的 pageContext 为 `ppm_project` 时，store 新增 `autoTeamIntent` 标记。
- `floating-session-host.tsx`：`autoNewPending` 打开预会话后，把 autoTeamIntent 传入 SessionPanel（新 prop `autoTeamOpen`）。
- `session-panel.tsx`：预会话挂载时 `autoTeamOpen && openTeamPopover(defaultObjective)`（objective 预填「分析项目 X 当前迭代风险并给出建议」句式，可改）。
- `team-trigger-popover.tsx`：新增 `defaultProjectId` prop → `projectId` 初始化预选 + `scopeMode='project'` + effect 自动 `listProjectWorkspaces` 按 workspace_id 升序选第一个工作区（与 D-004@v2 同键）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/ppm/common/session_binding.py | 表 `PpmItemSessionLink` + `bind_session_to_ppm_item` upsert + item/File 元数据读取 helper |
| 新增 | backend/app/modules/ppm/common/router.py | `GET /api/ppm/item-sessions?kind=&item_id=`；main.py 挂载 `/api/ppm` |
| 新增 | backend/migrations/versions/<rev>_add_ppm_item_session_links.py | 建表迁移（唯一约束 kind+item_id+session_id） |
| 修改 | backend/app/modules/daemon/schema.py | `SessionCreateRequest` + `ppm_item_kind`/`ppm_item_id`；`SessionInjectRequest` + `bind_ppm_item_kind`/`bind_ppm_item_id`。数据流：producer=前端 createSession/injectSession → daemon/router.py 反序列化 → consumer=SessionService.create_session/inject_session |
| 修改 | backend/app/modules/daemon/session/context.py | 新增 `build_ppm_item_context_preamble`；create_session 前导段调用 |
| 修改 | backend/app/modules/daemon/session/service.py | create_session：校验 item 存在→解析工作区→附件物化（storage 读 IO/_can_access/降级决策在写事务外，SessionAttachment 行 insert 在写事务内 flush-only）→写 link→前导（消费 attachment_lines）→附件组装；inject_session：追问绑定段新增 ppm 分支（:2325-2347 旁）；list_sessions 筛选子查询新增 ppm 维度（:4219-4302 旁） |
| 修改 | backend/app/modules/daemon/router.py | sessions 列表端点新增 `ppm_item_kind`/`ppm_item_id` query 参数透传 |
| 修改 | backend/app/main.py | 挂载 ppm common router |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 从后端 OpenAPI 再生成（本变更后端 schema 有改动，必须同变更提交） |
| 修改 | frontend/src/lib/daemon.ts | `createSession`/`injectSession`/`listAgentSessions` 新参数透传；新增 `listItemSessions(kind, itemId)` |
| 修改 | frontend/src/lib/session-mention-sources.ts | `useMentionSources` 新增 PPM 任务/问题分组（默认进行中可切全部） |
| 修改 | frontend/src/lib/query-keys.ts | mentionSources 缓存键新增 ppm 分组键（ppmTasks/ppmProblems） |
| 修改 | frontend/src/lib/session-mention.ts | mention 条目类型扩展 `ppmItem` |
| 修改 | frontend/src/components/daemon/session-mention-popover.tsx | 渲染 PPM 分组 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | `SessionPreContext` 扩展 `ppmItem`；`handlePreSessionSend` 上送；`mentionBindOptions` 扩展；`autoTeamOpen` prop 消费 |
| 修改 | frontend/src/components/daemon/team-trigger-popover.tsx | 新增 `defaultProjectId` prop：projectId 预选 + scopeMode=project + 自动拉关联工作区选第一个 |
| 修改 | frontend/src/components/floating/floating-session-host.tsx | autoTeamIntent → SessionPanel autoTeamOpen 通道 |
| 修改 | frontend/src/stores/floating-session.ts | `FloatingPreContext` 扩展 `ppmItem`；新增 `pendingPpmItem` 挂起位（requestNewSession 清 preContext，入口经挂起位传递）；requestNewSession ppm_project 时置 autoTeamIntent |
| 新增 | frontend/src/components/ppm/ppm-item-sessions-card.tsx | 任务/问题通用关联会话卡片 |
| 修改 | frontend/src/app/(dashboard)/ppm/task-plans/page.tsx | 个人任务行操作加「发起会话」+ 卡片挂载 |
| 修改 | frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx | 同上（我的任务行） |
| 修改 | frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx | 详情底部入口 + 卡片挂载 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 关联筛选新增 ppm 选项（value `ppm:<kind>:<uuid>`） |

sillyhub-daemon 仓**零改动**（附件走既有 SessionInjectAttachment 协议与 session-attachments 下载端点，D-006 物化策略保证 id 兼容）。

## 7. 接口定义

```python
# ppm/common/session_binding.py
class PpmItemSessionLink(BaseModel, table=True):
    __tablename__ = "ppm_item_session_links"
    __table_args__ = (UniqueConstraint("kind", "item_id", "session_id"),)
    kind: str            # "plan_task" | "problem"
    item_id: uuid.UUID   # 软关联，无 FK（对齐 quicklog 模式）
    session_id: uuid.UUID  # FK agent_sessions.id ON DELETE CASCADE
    workspace_id: uuid.UUID | None  # item 所属项目第一个关联工作区，可空

async def bind_session_to_ppm_item(db, *, workspace_id: UUID|None, kind: str,
                                    item_id: UUID, session_id: UUID) -> None
# upsert（ON CONFLICT DO NOTHING 语义），savepoint 自吞异常，幂等 best-effort

# daemon/session/context.py
def build_ppm_item_context_preamble(db, kind: str, item_id: UUID, *,
                                    attachment_lines: list[str]) -> str | None
# None = item 不存在（调用方跳过注入，不报错）

# daemon/session/service.py（create_session 内）
async def _materialize_ppm_attachments(self, file_ids: list[str], *, user_id, session_id,
                                       provider: str, manual_counts: dict) -> list[str]
# 返回降级文字清单行（未物化条目）；物化行并入 validated_attachments
```

REST 变更：

| 端点 | 方法 | 变更 |
|---|---|---|
| `/api/daemon/sessions` | POST | body 新增 `ppm_item_kind?`/`ppm_item_id?`（二选一成对） |
| `/api/daemon/sessions/{id}/inject` | POST | body 新增 `bind_ppm_item_kind?`/`bind_ppm_item_id?` |
| `/api/daemon/sessions` | GET | query 新增 `ppm_item_kind?`/`ppm_item_id?` |
| `/api/ppm/item-sessions` | GET（新增） | query `kind`+`item_id` → 会话列表（同 change sessions 响应结构） |

## 7.5 生命周期契约表

本变更涉及 session 生命周期，契约如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session with ppm item | frontend | backend | ppm_item_kind, ppm_item_id, first_message | 写 ppm_item_session_links；session pending→active（不变更既有 session 状态机） |
| materialize ppm attachments | backend | backend（session_attachment） | file_ids → SessionAttachment rows | draft 语义跳过：session_id 创建即回填（bound） |
| SESSION_INJECT（首 turn） | backend | daemon | prompt（含 PPM 前导）、attachments[]（含物化 PPM 附件） | 首条 user 消息落地；block/disk 交付决策在 backend |
| bind on follow-up inject | frontend | backend | bind_ppm_item_kind, bind_ppm_item_id | 追加 link（幂等）；**不注入前导** |
| list item sessions | frontend | backend | kind, item_id | 只读，无状态变化 |

## 8. 数据模型

- 新表 `ppm_item_session_links`（唯一迁移，见文件清单）。不修改 `agent_sessions`（沿用 M:N 真相源模式，AgentSession.change_id 的冻结教训 D-002@2026-08-25 不再走单 FK 冗余）。
- 不修改 `ppm_plan_task`/`ppm_problem_list`/`file`/`session_attachments` 表结构（物化复用现有列）。

## 9. 兼容策略

- 未携带 ppm 参数的创建/追问/列表请求：行为与现状完全一致（新字段全部 Optional，缺省跳过绑定段）。
- `ppm_item_id` 不存在/已删：创建会话**不报错**（降级为无 PPM 前导的普通会话，记 warning 日志），对齐 quicklog 容错口径。
- 旧会话不受影响：links 表为空表，既有会话查询零命中。
- 回退路径：删除 links 表 + 代码回滚即可，无数据迁移副作用。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Alembic 并行变更撞 revision 多 head（知识库已知坑） | P1 | migration 文件单独提交前 `alembic heads` 检查；本变更仅 1 个迁移文件 |
| R-02 | PPM 附件物化放大存储（多会话×多附件复制） | P2 | 单任务附件上限 10（图5文5）物化；任务附件通常个位数；sha256 去重机制在 session attachment storage 已有 |
| R-03 | file_urls 历史数据混有旧 URL 字符串（非 file_id） | P1 | 物化前 uuid 解析过滤，非 uuid 条目直接走文字清单降级 |
| R-07 | 非上传者的 PPM 附件无法读取（file 模块 owner-only 访问模型） | P2 | 复用 `_can_access` 口径：无权条目降级文字清单仅列文件名注明「无权访问」，行为对齐 PPM UI 现状（batch_meta 同样静默剔除无权行），不引入跨用户文件读取（D-007） |
| R-04 | @联想 PPM 分组全量拉取性能（任务+问题各一页） | P2 | 走分页 API 默认 20 条 + 关键词前端过滤，与 change 分组同量级 |
| R-05 | 预会话 workspaceId 与 PPM 项目工作区解析不一致（用户切换工作区后绑定前导仍按原 workspace） | P2 | link.workspace_id 以创建时解析为准；会话 cwd 逻辑沿用现有 workspace_id 决策，不新增覆盖 |
| R-06 | session-panel.tsx 体量已大（4000+ 行）继续膨胀 | P2 | 新逻辑尽量落在独立文件（ppm-item-sessions-card / mention-sources），panel 内只加最小接线 |

## 11. 决策追踪

| 决策 | 状态 | 覆盖章节 / FR |
|---|---|---|
| D-001@v1 关联入口双向 | accepted | Phase 3/4 → FR-01、FR-02、FR-05 |
| D-002@v1 全状态可关联 | accepted | Phase 4 → FR-02 |
| D-003@v1 附件真注入+降级 | accepted | Phase 2 → FR-03 |
| D-004@v1 多工作区自动选第一个 | accepted | Phase 1/3 → FR-01、FR-04 |
| D-004@v2 排序键定死 workspace_id 升序 | accepted（supersedes D-004@v1） | Phase 1/3 → FR-01、FR-04 |
| D-005@v1 统一 PPM 绑定表 | accepted | Phase 1 → FR-01 |
| D-006@v1 附件物化 SessionAttachment | accepted | Phase 2 → FR-03 |
| D-007@v1 PPM 附件访问控制复用 _can_access | accepted | Phase 2 → FR-03 |

无未解决决策；剩余风险见 §10。

## 12. 自审

- ✅ 章节齐全（背景/目标/非目标/拆分/总体方案/文件清单/接口/生命周期契约表/数据模型/兼容/风险/决策追踪）。
- ✅ 生命周期契约表已含（涉及 session 关键词）。
- ✅ 文件清单含对外字段数据流标注（schema.py 行）；api-types.ts gen:types 联动已列。
- ✅ 决策 D-001~D-007 全部被设计章节引用；方案选择（D-005）与附件物化（D-006）有代码证据锚点。
- ✅ 原型已生成（prototype-session-ppm-task-binding.html，双主题三场景），与文件清单前端项对齐。
- ✅ Design Grill 交叉审查已完成（独立子代理，11 项交叉检查）：X-01 降级链接修正为 `GET /api/file/{file_id}`、X-02 访问控制口径落 D-007、X-03 排序键定死（D-004@v2）、X-04 触发通道改 store 挂起位、X-05 步骤序修正、X-06 atEnabled 门控沿用、X-10 物化事务口径写明；原自审存疑 1（status 多值）与存疑 2（问题个人维度）已由源码定谳关闭。
