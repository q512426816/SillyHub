---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: brainstorm
scale: large
tier: independent
---

# 设计：会话输入框智能联想（/ 技能指令 + @ 关联变更/快速修复）

对应 proposal.md 推荐方案 B（前端联想 + 后端最小扩展）。方案 A = 本设计去掉 W2
后端部分的子集；方案 C 已否决。

> **行号基准**：文中 file:line 为 2026-08-26 工作区快照（多 agent 并行编辑会漂移，
> plan/execute 阶段以符号 grep 重新定位为准；两处已知漂移：sillyhub-daemon
> daemon.ts linkSkillsToWorkdir 调用 ≈:3780、session/service.py 行锁 ≈:2259）。

## 1. 背景与目标

见 proposal.md。一句话：把「平台已有的技能、变更、快速修复」在输入框里变成可发现、
可选择、可关联的一等公民，且不触碰消息模型与渲染协议。

## 2. 现状锚点（调研结论，file:line 为证）

- 输入框：`frontend/src/components/daemon/session-input-bar.tsx`（受控 textarea +
  附件流），唯一父组件 `session-panel.tsx` 3 个渲染点（page 预会话 :2202、page 真
  会话 :2571、dialog :4169）；宿主 `/sessions` 门户、悬浮抽屉（floating）、弹窗续聊
  三处共享，故只改 SessionInputBar + SessionPanel 即全量生效。
- 唯一 slash 先例 `/team`：`parseTeamCommand`（session-panel.tsx:372-375）发送时
  整条匹配；拦截开 team popover（:1801-1811）或剥离前缀直发（:1817，ql-20260826-013：
  原文透传会被 Claude Code 当未知 slash command 报错——**证明 SDK prompt 中词首 `/`
  会被 Claude Code 解析为 slash command**，已知技能同理可被调用）。
- 技能三层与落盘：manifest 端点 `GET /api/daemon/skills/latest/manifest`
  （daemon/router.py:3981，聚合 skills_bundle_service.py:208-235，**name=顶层目录名**，
  frontmatter name 如 `sillyspec:archive` 与目录名 `sillyspec-archive` 可能不一致）；
  用户自定义技能 per-user 并入同一 manifest；daemon `linkSkillsToWorkdir`
  （skill-manager.ts:425-469，交互会话调用点 daemon.ts:3743-3752）spawn 前把技能
  落盘 `<workdir>/.claude/skills/`。
- 变更/快速修复：`GET /api/workspaces/{wid}/changes`（ChangeList）、
  `GET /api/workspaces/{wid}/quicklog-entries`；「关联」筛选下拉先例
  session-list-panel.tsx:519-575（value=`change:${id}`/`quicklog:${ql_id}`，
  过滤 placeholder 条目）。
- 绑定契约：create 已有 `change_id`/`quicklog_id`（daemon/schema.py:181-189）；
  inject（:217-251）**无**对应字段；幂等 binder `bind_session_to_change`（按
  workspace+change_key，缺行建 placeholder）/`bind_session_to_quicklog`（按 ql_id）
  位于 change/binding.py:109/188。`default` 是 CLI 伪 change_key，联想与绑定均跳过。

## 2.1 决策记录（决策/方案选择）

- **D-001 方案选择**：三方案对比后定为 **方案 B（前端联想 + 后端最小扩展）**，
  用户于 brainstorm Step 4 确认（进度库可回放）；方案 A（纯前端）降为 W1 子集，
  方案 C（消息级 mention 实体化）因需迁移消息表+改渲染协议否决。依据：
  proposal.md 方案对比表。
- **D-002 透传格式**：`/技能` 原样透传不剥离（区别于 /team 平台指令的剥离），
  依赖 daemon 已把技能落盘 `<workdir>/.claude/skills/`；平台技能冒号名风险以
  manifest 新增 `invoke_name` 根治（§4.1）。
- **D-003 绑定通道**：@ 关联走既有 M:N link + 幂等 binder，**不碰消息模型**；
  inject 新增 `bind_change_key`/`bind_quick_id` 仿 `page_context` 可选字段模式，
  插入点在行锁后、tool_report 早退前以覆盖忙轮排队路径（§4.2）。
- **D-004 跨 workspace 语义**：保持 binder 既有 placeholder 行为（仅在会话自有
  工作区建行，与 run_sync 通道暴露面一致），不为 inject 单开分歧分支（§4.2）。
- **D-005 字段约束对齐**：`bind_quick_id` max_length=128 对齐 create 通道
  `quicklog_id` 契约与列宽，同语义同约束（Design Grill 修正）。
- **D-006 非目标边界**：不做消息 chip/↑ 历史回溯/工作区技能联想/解绑 UI
  （proposal 非目标清单，tasks 无越界任务）。

## 3. 交互设计

### 3.1 触发与关闭

- 触发：光标左侧回看，`/` 或 `@` 位于行首或空格之后（词首），且从该字符到光标
  只有「触发字符 + 查询串」（查询串不含空白；含空白即视为普通文本，浮层关闭）。
- 检测为纯函数 `detectMention(value, caretIndex)`（新文件 lib/session-mention.ts，
  便于 jsdom 单测），返回 `{ trigger: "/" | "@", query, startIndex } | null`。
- 关闭：Esc、失焦（blur 且非浮层内点击）、查询串含空白、输入被清空、发送后。
- IME：compositionstart 置 ref 标记，组合期间跳过检测与 Enter/Tab 拦截；
  compositionend 后对最终文本重新检测（中文用户拼音里带 `/` `@` 不误触）。

### 3.2 浮层（新组件 session-mention-popover.tsx）

- 位置与风格：输入胶囊上方 `absolute bottom-full`，对齐 team-trigger-popover 的
  自定义浮层惯例（daemon 组件族避用 antd，规避中文按钮 autoLetterSpacing 拆分坑，
  见 team-trigger-popover.tsx:33-35 注释）；最大高度约 260px 内部滚动。
- `/` 分组：内置指令（/team，标注「平台指令」）→ 技能（manifest.skills，name +
  description 单行截断）；按查询串过滤（name 前缀优先、包含次之，大小写不敏感）。
- `@` 分组：变更（title||change_key + change_key）→ 快速修复（ql_id + title，
  过滤 placeholder）；过滤同上。
- 键盘：↑/↓ 循环移动、Enter/Tab 确认、Esc 关闭；浮层激活时 Enter 不触发发送。
- 无障碍：role="listbox"/"option"/aria-selected；aria-activedescendant 跟随高亮。

### 3.3 选中回填与光标（复核修订：命题 4/5）

- `/`：把 `startIndex..光标` 替换为 `/<invoke_name ?? name> `（后随空格）。
- `@`：替换为 `@<change_key> ` 或 `@<ql_id> `（自然键无空格，安全；不用带空格的
  title）。同时通过 `onMentionsChange` 把结构化选中对象回传父级
  （`{ change?: {id, change_key}, quick?: {ql_id} }`，同类型后选覆盖先选）。
- **光标实现模式（仓库 setSelectionRange 零先例，首例）**：onChange 内读
  `e.target.selectionStart` → 组装新文本调 onChange → 记 `pendingCaretRef` →
  `useEffect` 中 `textareaRef.current.setSelectionRange(pos, pos)` 延迟执行
  （同步调用会被 React 受控 value 的 DOM 更新覆盖，光标跳末尾）；jsdom 用例断言
  回填后光标位置。
- **发送组装实际 7 个点位**（Design Grill 修正：原记 6 处漏 dialog 版
  sendToServerQueue）：createSession ×2（page 预会话 :1719 / dialog :3635）+
  injectSession ×5（page sendFromQueue :1546 / page sendToServerQueue :1612 /
  page 重发 :1952（不带 mentions，R-7 取舍）/ dialog submitFollowup :3428 /
  **dialog sendToServerQueue :3496**，定义 :3491，由 dialog handleSend 的
  running 分支 :3684 调用——dialog 忙轮场景，漏改则 FR-06 在该场景静默失效）。
  dialog 重发（≈:3706）复用 submitFollowup，随该点位一并生效。

### 3.4 发送语义（SessionPanel handleSend 三处）

- `/team` 整条匹配的拦截/剥离/回填逻辑原样保留，优先级最高。
- 其他 `/技能`：原文透传，不剥离（依赖 §4.3 invoke_name 保证名字可被 Claude Code
  识别；codex 引擎收到原文无害）。
- pendingMentions：预会话 → create body 带_change_id/quicklog_id（既有契约）；
  真会话 → inject body 带 bind_change_key/bind_quick_id（§4.2）。发送成功后清空
  pendingMentions（与 clearAttachments 同时机）；草稿持久化不存 pendingMentions
  （草稿恢复后 @ 文本仍在，但绑定需重新选择——记录在已知取舍）。
- 与 team popover 互斥：team 拦截时 setInput("") 已使 mention 检测归零自动关闭；
  浮层与 TeamTriggerRow 同锚区，z-index 取同一层级族，二者不同时可见
  （team 打开前提是刚发送/输入被清空）。

## 4. 后端设计（方案 B 增量，均可独立回滚）

### 4.1 manifest invoke_name（FR-07；复核命题 1/8 修订）

- `skills_bundle_service.py` 的 `_parse_skill_frontmatter`（:171-205）**已同时解析
  name 与 description**，聚合 `_summarize_skills`（:208-235）在 :230 仅取
  description；改为把 frontmatter name 原值放入聚合结果新键 `invoke_name`
  （frontmatter 缺 name 或解析失败 → None；目录名兜底由前端
  `invoke_name ?? name` 完成）。改动点：:226 初始化、:230 取值、:232-234 输出 dict。
- **无响应模型可改**：manifest 端点返回 `dict[str, Any]`（daemon/router.py:3985），
  不存在 Pydantic 响应模型——不需要也不应该在 schema 层加字段。
- 版本兼容：`_compute_version`（:149-167）只哈希目录名 + 文件相对路径 + 内容，
  不含聚合摘要 → 加键不触发 daemon 重同步；daemon 侧（skill-manager.ts）版本比对
  只看 version、bundle 校验只用 files[].sha256，零影响。
- **前端类型手写同步**：manifest 类型本就手写（custom-skills.ts:53-82，端点无
  OpenAPI 类型化 schema，文件头已注释说明）——`PlatformSkillSummary`（:63-70）加
  `invoke_name?: string | null` 并注释来源，属既有手写惯例，不违反 CLAUDE.md
  规则 21（该规则只约束 api-types.ts 生成纪律）。

### 4.2 inject 绑定字段（FR-06；复核命题 2/3 修订）

- `SessionInjectRequest`（daemon/schema.py:217-251）新增：
  - `bind_change_key: str | None = Field(default=None, max_length=200)`
  - `bind_quick_id: str | None = Field(default=None, max_length=128, pattern=r"^ql-[\w-]+$")`
    （Design Grill 修正：128 对齐 create 通道 quicklog_id 契约（schema.py:189）与
    QuicklogSessionLink.ql_id 列宽 String(128)（model.py:332），同语义字段同约束，
    不引入双标准）
  - `_require_prompt_or_switch`（:242-251）**不得**把 bind 字段纳入空 prompt 豁免。
- **三层透传同步**（router inject_session :2305-2336 → Facade
  `DaemonService.inject_session` :692-719 → `SessionService.inject_session`
  :2171；Facade :669 注释有「漏透传会 500」教训，三层必须同步加参）。
- **插入点（关键）**：`SessionService.inject_session` 内，归属校验+行锁（:2242）
  之后、tool_report 懒激活早退（:2258）之前。不能放进 `_inject_into_session`
  深处——忙轮排队早退分支（:2390-2457，queue_when_busy 时写
  AgentSessionQueuedMessage 后直接 return）会跳过 binder，而前端 running 态走
  `sendToServerQueue`（session-panel.tsx:1830-1832）恰是排队路径 → 绑定静默丢失
  且前端已清 pendingMentions。
- binder 调用：显式传 `session.workspace_id`；**None 守卫**（照抄 create 先例
  session/service.py:1220-1232：记 warning 跳过）。失败语义：binder 自身已用
  savepoint + log.warning 保证不抛（binding.py:178-185/:223-230），SessionService
  侧无需重复 try/except 包裹，仅在调用后按返回值记结构化日志即可——「best-effort
  失败不阻断消息发送」由此天然成立（T2.2 有对应用例）。
- 边界澄清：`inject_session_as_service`（session/service.py:≈2292，平台 service
  身份旁路）不消费 SessionInjectRequest、不经三层链路，**无需改动**；行锁窗口内
  做 savepoint 查询+插入会轻微拉长锁持有时长，可接受（绑定操作轻量，无外部 IO）。
- **跨 workspace 语义（写死）**：保持 binder 既有 placeholder 行为——别的工作区
  的 change_key 在会话**自有**工作区查不到行时建 placeholder（binder 按
  (workspace_id, change_key) 过滤，binding.py:131-138，placeholder 的 workspace_id
  来自入参 :140-152）。暴露面 = 自有工作区内可造 placeholder 垃圾行，与既有
  run_sync 通道（任意 `--change` 值同建 placeholder）完全一致，接受；不为 inject
  通道单开「查无行不建」的分歧分支。

### 4.3 透传链路（零改动，仅说明）

`/技能名` 随 prompt → daemon → Claude Agent SDK → Claude Code 词首 slash 解析 →
命中 `.claude/skills/` 已落盘技能即调用。本链路已由 ql-20260826-013 反向实证
（未知名报错=已知名可调用的对称面）；execute 阶段补一条实测冒烟验证。

## 5. 数据流

```
输入变化 ──detectMention──▶ 浮层开/关/过滤（纯前端，零网络）
选中 ──▶ 回填文本 + onMentionsChange(pendingMentions)
发送 ──▶ 预会话: createSession({change_id?, quicklog_id?})      [既有]
         真会话: injectSession({bind_change_key?, bind_quick_id?}) [新增]
       └▶ backend inject → binder 幂等写 M:N link（不注入 prompt）
浮层数据 ──▶ usePlatformSkillsManifest / listChanges / listQuicklogEntries
            （挂载 prefetch，staleTime 5min，workspaceId 为空时 @ 联想禁用）
```

## 6. 文件变更清单（File Changes / 文件清单）

新增（前端）：
- `frontend/src/lib/session-mention.ts`（detectMention 与选中回填纯函数）
- `frontend/src/lib/session-mention-sources.ts`（useMentionSources 联想数据 hooks）
- `frontend/src/components/daemon/session-mention-popover.tsx`（联想浮层组件）
- `frontend/src/lib/__tests__/session-mention.test.ts`（纯函数单测）
- `frontend/src/lib/__tests__/session-mention-sources.test.tsx`（hooks 单测）
- `frontend/src/lib/__tests__/daemon-session.test.ts`（injectSession bind 断言）
- `frontend/src/components/daemon/__tests__/session-mention-popover.test.tsx`（浮层单测）
- `frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx`（接入单测）

修改（前端）：
- `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`（追问态 placeholder 断言随文案更新）
- `frontend/src/components/daemon/session-input-bar.tsx`（检测驱动浮层与 IME 与光标回填与 onMentionsChange）
- `frontend/src/components/daemon/session-panel.tsx`（3 渲染点接线与 7 发送组装点位与 placeholder 文案）
- `frontend/src/lib/daemon.ts`（injectSession 请求体透传 bind 字段）
- `frontend/src/lib/custom-skills.ts`（PlatformSkillSummary 手写加 invoke_name）
- `frontend/src/lib/query-keys.ts`（联想数据缓存键）

修改（后端）：
- `backend/app/modules/daemon/schema.py`（SessionInjectRequest 加 bind 字段）
- `backend/app/modules/daemon/router.py`（inject 路由层透传）
- `backend/app/modules/daemon/service.py`（Facade 层透传）
- `backend/app/modules/daemon/session/service.py`（binder 插入与 None 守卫）
- `backend/app/modules/agent/skills_bundle_service.py`（invoke_name 聚合透传）

测试（后端）：
- `backend/app/modules/daemon/tests/test_session_service.py`（binder 与 None 与跨 workspace 用例）
- `backend/app/modules/daemon/tests/test_session_router.py`（inject 端点字段校验）
- `backend/app/modules/daemon/tests/test_session_queue.py`（忙轮排队路径仍绑定）
- `backend/app/modules/daemon/tests/test_skills_bundle.py`（invoke_name 用例）

生成产物（随变更提交）：
- `frontend/src/lib/api-types.ts`（pnpm gen:types 生成）
- `backend/openapi.json`（pnpm gen:types 生成）

不修改文件：消息模型（AgentRunLog）、渲染协议、`/team` 语义、team popover、附件流。

## 7. 风险（Risk / 风险登记；复核后更新）

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | 平台技能 slash 名不匹配（目录名 vs 冒号名）导致 Unknown command | invoke_name 扩展（FR-07）；**冒号名可调用性是对称推断（ql-013 只证未知名报错），execute 期真实会话实测冒烟为硬性验收**（平台冒号名 + 用户技能各一条） |
| R-2 | Enter 语义冲突（浮层激活时 Enter 误发送） | 拦截规则集中在 onKeyDown 首位 + jsdom 用例覆盖 |
| R-3 | 中文 IME 组合期误弹/误选 | composition 标记 + compositionend 重检，用例覆盖 |
| R-4 | inject 绑定越权面 | **复核已验证**：binder 按 (workspace_id, change_key) 过滤 + inject 传 session.workspace_id + None 守卫；残余面 = 自有工作区 placeholder 垃圾行，与 run_sync 通道一致，接受（§4.2 写死）；用例固化「跨 workspace 只污染会话工作区」 |
| R-5 | 浮层与 team popover / 附件降级提示条叠层冲突 | 同锚区互斥规则 + z-index 同层族；T1.2/T1.3 叠层与互斥用例（Design Grill 补落点） |
| R-6 | manifest/changes 频繁查询拖慢输入 | 挂载 prefetch + staleTime，输入零请求 |
| R-7 | 草稿恢复/重发链路 pendingMentions 丢失（@ 文本在但绑定失效） | 已知取舍：文本保留提示用户重选；二期可草稿带 mentions |
| R-8 | 与 2026-08-26-workspace-skill-edit（worktree 未合）并行冲突 | 双方都动 workspace/skills 相关面极小；本变更不触其 5 个写端点；合并顺序执行期再评估 |
| R-9 | manifest 手写类型漂移（custom-skills.ts 不在生成管线） | invoke_name 手写同步 + 注释标注来源；后端字段改名时此文件需人肉跟改（既有惯例，非本变更新增） |
| R-10 | 忙轮排队路径绑定丢失（page 与 dialog 双变体） | **设计已消除**：binder 插入点在排队早退分支之前（§4.2）+ **7 个发送点位清单含 dialog sendToServerQueue :3496**（Design Grill 修正）；test_session_queue.py 用例守护防回归 |

## 8. 自审（Self-Review；含独立复核回执）

- 是否绕开消息模型？是——绑定走既有 M:N 表 + 幂等 binder，消息行零改动（对比
  方案 C 的核心否决理由，守住）。
- `/team` 兼容？拦截优先级置于联想之前，语义零改动；选中回填带尾空格使浮层自动
  关闭、整条正则仍命中（复核命题 6 验证自洽）。守住 NFR-04。
- 三处渲染点是否会漏改？SessionInputBar 受控设计使浮层内聚在组件内，父级仅加
  onMentionsChange 与发送组装；复核澄清实际 6 个发送组装点位，已入 §3.3/§6/tasks
  清单防漏。
- codex 引擎？浮层照常、透传无害（requirements NFR-03 已述）；且技能落盘对两类
  引擎均无条件执行（复核命题 9）。
- **独立复核回执**：裁决「需修订后可行」，10 项命题 8 项直接可行、2 项可控风险，
  6 条必须修订项已全部回写本文档（§3.3/§4.1/§4.2/§6/§7）与 tasks.md，详见
  review-feasibility.md。遗留最大不确定点收敛为 R-1 冒号名冒烟（execute 期硬验收）。

## 9. 生命周期契约

不涉及生命周期契约。本变更不改动 session/lease/agent_run/daemon 的状态机、心跳、
claim 等生命周期事件，仅新增输入联想 UI 与 inject 可选绑定字段的旁路写（binder
幂等、失败不阻断、不改会话状态）。
