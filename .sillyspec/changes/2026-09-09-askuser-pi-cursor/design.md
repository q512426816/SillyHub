---
author: qinyi
created_at: 2026-09-09 22:20:53
scale: large
---

# 设计文档（Design）— AskUser 提问通道 pi/cursor 接入 + 群聊 pending 提问聚合

> v2（2026-09-09 Design Grill 返工）：Wave B 改纯前端标记渲染（P0-1 修正）；统一载荷补 dialog_payload.questions 映射（P1-3）；群聊答题授权放开入范围（P1-2，按用户既定拍板）；文件清单/引证勘误（P2/P3）。

## 背景

平台的「agent 向用户提问」（AskUser）链路：daemon 驱动 → backend `handle_permission_request`（带 `dialog_kind`）→ `SessionDialogRequest`（model.py:285，列 `dialog_payload` 自由 JSON）持久化 + SSE 广播 → 前端 `AskUserDialogCard`（文件头明言 provider 无关）→ 用户提交 → `PERMISSION_RESPONSE` 下行 → daemon settle 挂起 promise。这条中间管道是引擎无关的通用件。

当前四引擎接入状态：

- **claude**：SDK `canUseTool` / `request_user_dialog`（AskUserQuestion）已通。
- **codex**：app-server `request_user_input` 已桥接（`dialog_kind=codex_request_user_input`，2026-09-03-agent-provider-abstraction task-05/06）——pi 桥接的活模板（codex-app-server-driver.ts L1823-1856）。
- **pi**：RPC 模式 `extension_ui_request` 的 dialog 类（select/confirm/input/editor）被驱动一律自动回 cancelled（pi-rpc-driver.ts L822-861，permission_dialog=false；计划审查勘正行号），pi-onboarding 设计文档明言「桥接留后续」。
- **cursor**：无头 `-p --trust --force` 模式无任何对话/审批通道（驱动文件头声明 manualApproval/askUserOnly「无对应 CLI 通道，忽略」）。
- **群聊**：提问卡只挂单会话时间线，群聊面板无 dialog 挂载点——claude 成员在群里提问用户也看不到（存量独立缺口）。且影子会话（shadow.py:478 user_id=群主）答题权限为群主/admin 专属（permission_service.py:1119-1123 ownership 门）。

后端 `context_builder.py` 已有「必须调用 `AskUserQuestion` 工具」提示词约定与 `ask_user_only=True` 会话配置（`daemon/schema.py:206-207` 默认双 True）。

用户需求：pi/cursor 会话具备提问能力；群聊可见并可回答成员提问（任何成员先到先得 + agent 推荐艾特回答人）。

## 设计目标

| 编号 | 目标 |
|---|---|
| FR-01 | pi 会话轮中阻塞提问：`extension_ui_request` 提问类桥接平台 dialog，用户作答后 pi 同轮继续 |
| FR-02 | pi 桥接语义对齐平台：dialog 永久等待不超时、会话中止/驱动 close 兜底回 cancelled、权限类请求零桥接（继续自动拒绝） |
| FR-03 | cursor 轮界标记提问（纯前端渲染协议）：`askuser` JSON 尾块随消息文本持久化，前端渲染为提问卡；提交 = 答案组装为下一条用户消息发送，`--resume chatId` 续轮 |
| FR-04 | cursor 标记协议 spike 门槛：真机验证模型遵守率（≥8/10），不达标则不注入提示词、cursor 降级自然语言提问（功能不坏） |
| FR-05 | 群聊聚合：成员原生提问（pi/claude/codex）在群聊流内渲染，**任何群成员**先到先得作答（放开影子会话答题授权），agent 可推荐回答人（@软提示）；cursor 标记卡在群消息流内同样可渲染可答 |
| FR-06 | caps 能力位：daemon/backend/frontend 三端 `dialog: 'native' \| 'marker' \| 'none'`（string 枚举），联动对齐测试解析器同步扩展 |

## 非目标

- 不做 cursor 轮中阻塞（无头 CLI 做不到）。
- 不做群聊「仅定向人可答」硬门控（D-004：推荐人是软提示）。
- 不改 dialog 中间管道的提交/持久化/SSE/回流协议（唯一例外：影子会话**答题授权**放开，见 D-006@v2）。
- 不做 pi 权限类请求桥接（安全红线，D-002）。
- 不引入 DialogGateway 类新抽象层（D-007）。
- cursor 标记提问不经后端 dialog 管道（不建 pending 行、不答题端点——纯前端渲染 + 既有消息发送链路）。

## 拆分判断

单变更三波（D-001）：Wave A（pi 桥接）/ Wave B（cursor 纯前端标记协议 + spike）/ Wave C（群聊聚合 + 影子会话授权放开 + caps 收口）。三波共享统一标记协议与 caps 声明；波内可独立验收。

## 总体方案

架构 = D-007 方案 A（端头适配器直挂各驱动，与 claude/codex 同构）；cursor 例外——无通道，走**纯前端标记渲染协议**（D-003@v2）。

### 统一 AskUser 载荷与渲染映射

引擎端头形态（pi RPC 参数 / cursor 标记 JSON）→ 平台侧两种消费形态：

**① native 型（pi/claude/codex，走 dialog 管道）**：归一化为 AskUserDialogCard 契约的 `dialog_payload.questions[]`（ask-user-dialog-card.tsx L56-58）：

```ts
// pi extension_ui_request 参数 → questions[] 包装规则（daemon 端头完成）：
select   → { questions: [{ question, options: [{label}...] }], allowCustom? }   // 单问题
confirm  → { questions: [{ question, options: [{label:"是"},{label:"否"}] }] }  // 合成两选项
input    → { questions: [{ question, options: [{label:"由我输入"}] }] }（合成占位选项——卡片渲染前置要求 ≥1 选项：ask-user-dialog-card.tsx:104 守卫行丢弃无选项问题；自定义输入框在问题渲染后可用 L395-403；Grill 复审 N1 勘正，零卡片改动）
editor   → 同 input（大文本；占位选项 + 自定义输入）
// recommendResponders 平铺进 dialog_payload.recommendResponders（自由 JSON 透传，仅群聊卡渲染）
```

**② marker 型（cursor，纯前端）**：标记 JSON 字段 `kind/question/options/allowCustom/recommendResponders` → 前端 AskUserMarkerCard 直接消费（同词汇，无需包装）。

### Wave A · pi 轮中桥接（native）

1. `pi-rpc-driver.ts`：`extension_ui_request` 分派处（L784-829），dialog 类四方法从「自动 cancelled」改为：参数归一化 → questions[] 包装（上表）→ 经注入的 `sessionPermission.requestUserDialog`（session-manager.ts:676 现成方法）上抛；驱动内 `Map<rpcRequestId, replyFn>` 挂起表。
2. 答案回流：`PERMISSION_RESPONSE` 到达 → settle 挂起表 → 组装 pi RPC reply（denormalize 对照 rpc.md L1130-1217：select→所选值、confirm→bool、input/editor→文本）→ pi 同轮继续。
3. 兜底：会话 end/fail、驱动 close、abortAll → 挂起表统一回 `cancelled:true`；未知方法维持现状 fail-closed 自动取消。
4. 红线：pi 权限类 extension 请求零桥接，继续自动拒绝。
5. 注入通道：`sessionPermission` 目前在 driver-factory.ts L291-315 仅对 `provider==='codex'` 注入——扩展 pi 分支 + `PiStartOptions` 补 `sessionPermission?` 槽位（对齐 CodexStartOptions D-008@V1 形态）。
6. `permission_dialog` 翻真：pi 会话 caps `permission_dialog` 布尔键随本波置 true（providers.ts pi 段）。

### Wave B · cursor 纯前端标记协议（marker）

1. 标记格式：消息文本尾部 fenced 块 ` ```askuser\n{"kind":"select","question":"…","options":[…],"allowCustom":false,"recommendResponders":["张三"]}\n``` `；**标记随文本原样持久化**（不剥离——parseAttachmentMarkers 同款哲学：标记即数据，渲染层负责呈现）。
2. 前端解析器 `frontend/src/lib/askuser-marker.ts`（新增）：`parseAskUserMarker(text) → { payload, textBefore } | null`；宽容边界清单：JSON 单/多行、尾随空白、``` 后语言标注（```askuser 仅认该词，其它语言标注不吞）；非法 JSON / 必填字段缺失（kind/question）/ 载荷 >4KB / 出现在文本中部（仅尾部窗口扫描最后 8KB）→ null 当普通文本。
3. 渲染：`AskUserMarkerCard`（新增，视觉对齐 prototype-askuser-cards.html 场景三）在 turn-timeline 文本段解析命中处渲染卡片并隐藏标记原文；「已回答」态 = 本地 best-effort 判定——该轮之后已存在用户消息（会话日志既有数据，无后端状态；启发式无法区分「回答」与「无关插话」，展示层语义，Grill 复审 N4）。
4. 提交：组装答案为下一条用户消息发送（既有发送链路；select→所选 label（+自定义文本）、confirm→是/否、input→输入文本）；cursor `--resume chatId` 续轮天然生效。
5. prompt 注入（daemon 侧唯一改动）：caps=marker 的 provider 每轮 prompt 前缀注入协议说明常量（何时问/格式样例/答案会作为下一条消息回来/推荐人字段可选）。
6. spike（先于编码）：真机 cursor 会话造 10 次需澄清场景，合法标记（可解析+必填字段齐）≥8/10 达标；不达标 → 不注入 prompt、caps=none，解析器与卡片保留（协议资产不丢）。
7. **不经后端 dialog 管道**（P0-1 修正核心）：无 pending 行、无 answer 端点、无 run 存活依赖——彻底绕开 permission_service 三处 run 不变量（提交需活跃 run L415-431 / 终态 run 孤儿卡过滤 L719-724 / 答题需活跃 run L989-994）。

### Wave C · 群聊聚合 + 影子会话授权放开 + caps 收口

1. 授权放开（后端小改，D-004@v2/D-006@v2）：答题授权门真实锚点 = `permission_service.py:949 _get_owned_session_for_update` → `helpers.py:357-359` → helpers.py 影子分支（session/service/helpers.py:407-451，计划审查勘正；Grill 复审 N3 的 :357-359 为群成员只读分支）——对**群聊影子会话**的 dialog answer 放开为「群成员可答」，影子判别用 `session_kind='group_member'`（model.py:845，带索引）+ 现成 `resolve_shadow_member`（group/service/helpers.py:288，计划审查勘正行号）校验答题者为该群成员（Grill 复审 N2 勘正：origin/aggregation_key 是 tool_report 聚合用途，非影子判别字段）；`answered_by` 记录**实际答题人**（修正现为群主失真的归属）。普通单聊会话授权语义不变。另需处理 L959-963 的 manual_approval 第二道守卫（群聊影子 manual_approval 恒关是现状——dialog **提问类**放行须豁免该守卫的审批语义，仅限 ask_user 类，权限审批语义不动，Grill 计划审查补充）。
2. 群聊聚合渲染（group-chat-panel）：对成员影子会话逐个拉既有 pending dialogs 接口（成员 ≤5，随群聊既有刷新节拍）；pending 卡嵌群聊消息流（复用 AskUserDialogCard + 成员 agent 头像/名字标注来源）；后答者收 409 已答 → 渲染「已被 ×× 回答」关闭态（幂等判定已有）。推荐人 `recommendResponders` 渲染「💡 推荐 @xx 回答」条。
3. cursor 标记卡进群聊：群消息行渲染层复用 `parseAskUserMarker` + AskUserMarkerCard（marker 型任何人可直接以消息作答——发消息即答案，天然先到先得：agent 下一轮只消费最新用户消息）。
4. caps 三端收口：providers.ts / provider_caps.py / provider-caps.ts 增 `dialog` **string 枚举键**（打破「全 boolean」旧约定——对齐测试解析器 `_TS_BOOL_PAIR_RE` 同步扩展 string 值支持，三端注释同步更新；未知 provider 回退 `'none'`）；值：claude/codex=`native`、pi=`native`（随 Wave A）、cursor=`marker`（spike 达标）或 `none`（降级）。

## 文件变更清单

主仓（无跨仓变更；路径相对仓库根）：

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | dialog 类四方法桥接：归一化 questions[] 包装 → sessionPermission.requestUserDialog 上抛；挂起表；答案 denormalize 回 RPC reply；close/abort 兜底 cancelled；权限类维持自动拒绝 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | sessionPermission 注入扩展 pi 分支（现仅 codex，L291-315） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | marker 型 provider prompt 前缀注入协议常量（consume 入口按 caps 分派）；requestUserDialog 路径复用零接口变更 |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 增 dialog string 枚举键（pi=native + permission_dialog 翻 true；cursor=marker/none 视 spike）；「全 boolean」注释更新 |
| 修改 | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（及 session-manager 相关既有测试文件） | pi 桥接四态：上抛/应答回流/中止兜底/权限类拒绝 + prompt 注入用例（daemon 测试在 tests/interactive/ 目录） |
| 修改 | backend/app/modules/agent/provider_caps.py | dialog 能力位镜像 |
| 修改 | backend/app/modules/agent/tests/test_provider_caps_alignment.py | 联动对齐断言：dialog string 值解析器扩展（_TS_BOOL_PAIR_RE → 增 string 枚举支持）+ dialog 键断言 |
| 修改 | backend/app/modules/daemon/permission_service.py | 影子会话答题授权放开：群聊影子 session 的 dialog answer 允许群成员（判定+群成员校验）；answered_by 记实际答题人（数据流：answer 请求 user → permission_service 判群成员 → answered_by 落实际 user_id → SSE permission_resolved payload → 前端关闭态渲染 ×× 名） |
| 新增 | NEW:frontend/src/lib/askuser-marker.ts | 前端标记解析器 parseAskUserMarker（宽容边界清单见 Wave B.2） |
| 新增 | NEW:frontend/src/components/ask-user-marker-card.tsx | marker 型提问卡（视觉对齐原型场景三；已回答态=轮后存在用户消息本地判定） |
| 修改 | frontend/src/lib/provider-caps.ts | dialog 能力位镜像；marker 型分支（答案自动组装发送） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 文本段解析命中渲染 AskUserMarkerCard + 隐藏标记原文（含持久化历史文本——标记即数据） |
| 修改 | frontend/src/components/ask-user-dialog-card.tsx | 群聊模式渲染 recommendResponders 推荐条（dialog_payload.recommendResponders，producer=daemon 端头 → SessionDialogRequest.dialog_payload 自由 JSON 透传（无 schema 变更）→ consumer=本组件）；已答关闭态显示实际答题人名 |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 聚合成员影子会话 pending 原生提问 + 群消息行 marker 卡渲染；先到先得关闭态；成员来源标注 |
| 新增 | NEW:frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx | 聚合卡渲染/推荐条/已被回答态/授权放开后成员可答用例 |
| 新增 | NEW:frontend/src/lib/__tests__/askuser-marker.test.ts | 解析正反例（多形态/非法 JSON/超长/非尾部/语言标注变体） |

后端表结构零变更（dialog_kind 无白名单：protocol.py:250 自由 str、model.py:334 String(64)——R-07 已关闭；新值 pi_extension_ui 16 字符 < 64）。

## 接口定义

```ts
// frontend/src/lib/askuser-marker.ts（新增）
export interface AskUserMarkerPayload {
  kind: "select" | "confirm" | "input" | "editor";
  question: string;
  options?: Array<{ label: string }>;
  allowCustom?: boolean;
  recommendResponders?: string[];
}
export function parseAskUserMarker(text: string): { payload: AskUserMarkerPayload; textBefore: string } | null;

// pi-rpc-driver.ts 桥接（新增私有结构）
interface PendingDialog { rpcRequestId: number | string; reply: (r: Record<string, unknown>) => void; };
// 归一化：pi 四方法 params → dialog_payload.questions[]（映射表见总体方案①）
// denormalize：answers → pi 各方法 reply 形态（对照 rpc.md L1130-1217）

// dialog_kind 新值：'pi_extension_ui'（backend 无白名单，直接可用）

// caps（三端镜像，string 枚举）
dialog: "native" | "marker" | "none"; // 未知 provider 回退 'none'
```

spike 判据（FR-04）：10 次澄清场景合法标记 ≥8 次 → 达标；否则 Wave B 降级（不注入 prompt、caps=none、前端资产保留）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| pi extension_ui_request(dialog 类) | pi 进程 | daemon pi-rpc-driver | method, params, rpcRequestId | driver 挂起表 pending；轮内阻塞 |
| dialog 上报（PERMISSION_REQUEST+dialog_kind） | daemon | backend | sessionId, dialog_kind=pi_extension_ui, dialog_payload.questions[](AskUserPayload) | SessionDialogRequest pending 行 + SSE 广播 |
| 用户作答（answer） | 前端 | backend | requestId, dialog_result.answers, 实际答题人 user | 影子会话：群成员放行（D-004@v2）；pending → answered；answered_by=实际答题人；SSE permission_resolved |
| permission_response 下行 | backend | daemon | requestId, dialog_result | pi：settle 挂起表 → RPC reply → 轮继续（cursor marker 型无此事件） |
| 会话 end/fail / 驱动 close | daemon | pi 进程 | — | 挂起表统一 cancelled → pi 收到取消收尾 |
| cursor 标记轮 | cursor 进程 | （无后端事件） | — | 标记随文本落库；前端本地渲染卡/已答判定；答案经既有「发送消息」链路开新轮 |
| prompt 注入（marker 型） | daemon | cursor 进程 | 协议说明前缀 | 每轮 prompt 组装（caps=marker 分派） |

缺项说明：上表事件与 plan 任务卡一一对应（plan 阶段映射）；native 管道其余事件（claude/codex 既有）不在本表重复。

## 数据模型

无表结构变更。`SessionDialogRequest.dialog_kind`（model.py:334，String(64) 自由串）新增取值 `pi_extension_ui`；`dialog_payload`（自由 JSON）承载 questions[] 包装与可选 recommendResponders；`answered_by` 语义修正为实际答题人（列已存在，仅写入逻辑变化）。

## 兼容策略（brownfield 必填）

- 未开启（caps=none 或旧 daemon）：pi 维持自动取消、cursor 无提问、群聊不聚合——与今日一致。
- 旧 daemon + 新 backend/前端：dialog_kind 新值仅新 daemon 上报；AskUserDialogCard 对未知 kind 按通用问答渲染；caps 旧端无 dialog 键 → 前端回退 'none'。
- 回退路径：pi 桥接异常 fail-closed（自动取消保留兜底）；cursor spike 不达标整体不启用（不注入 prompt 即无标记）；群聊聚合与授权放开为独立提交可单独回退（授权放开仅影响影子会话 answer 分支）。
- 不改变的 API/表：handle_permission_request 及 answer 端点签名、SessionDialogRequest 列结构、PERMISSION_RESPONSE 下行协议；普通单聊会话答题授权语义不变。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | cursor 模型标记遵守率不足 | P1 | spike 门槛（≥8/10）；解析宽容多形态；降级 D-003@v2（不注入即无标记，功能不坏） |
| R-02 | pi dialog 永久等待 + 会话常驻挂起资源 | P2 | 挂起表随驱动生命周期销毁（close/abortAll 兜底）；量与 pi 并发 dialog 同阶 |
| R-03 | 群聊先到先得并发竞态 | P1 | 后端 answered 幂等 409 已有；前端渲染关闭态；不新增锁 |
| R-04 | 标记原文在流式与历史中的呈现一致性 | P2 | 标记即数据不剥离；前端渲染层统一隐藏标记原文（流式与持久化同一解析器）；未闭合围栏在流式期间可能瞬显后隐藏（best-effort 展示层，无功能影响，Grill 复审 N5） |
| R-05 | 提问通道被用于诱导性输入（社工） | P2 | 卡片副行「回答将发送给 AI」提示；权限类零桥接红线；推荐人仅软提示 |
| R-06 | pi 四类 reply 规格与 rpc.md 不齐 | P1 | 编码前逐方法对照 rpc.md L1130-1217；单测覆盖四类 reply 形态 |
| R-07 | ~~backend dialog_kind 白名单漏配~~ | 已关闭 | 审查证实无白名单（protocol.py:250 自由 str / String(64)），无需改 protocol.py |
| R-08 | 影子会话授权放开越权（非群成员借道答题） | P1 | 放开仅限「群聊影子会话 + 答题者为该群成员」双条件；单聊授权语义不变；单测覆盖越权反例 |
| R-09 | caps 全 boolean 约定破坏引发三端对齐测试连锁红 | P2 | 对齐测试解析器扩展与 caps 键同任务交付；注释同步更新；未知 provider 回退 'none' |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 单变更三波 | §拆分判断；plan Wave A/B/C | 已覆盖 |
| D-002@v1 pi 桥接+永久等待+红线 | §总体方案 Wave A；FR-01/FR-02；R-02/R-06 | 已覆盖 |
| D-003@v2 cursor 纯前端标记协议（supersedes v1） | §总体方案 Wave B；FR-03/FR-04；R-01/R-04 | 已覆盖 |
| D-004@v2 群聊先到先得+授权放开+推荐人（supersedes v1） | §总体方案 Wave C；FR-05；R-03/R-08 | 已覆盖 |
| D-005@v1 caps 能力位 | §总体方案 Wave C.4；FR-06；R-09 | 已覆盖（键形态改 string 枚举） |
| D-006@v2 管道复用+授权放开例外（supersedes v1） | §文件变更清单；§兼容策略 | 已覆盖 |
| D-007@v1 架构方案 A | §总体方案；§非目标 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记/生命周期契约表/数据模型/兼容策略/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本决策（D-001@v1、D-002@v1、D-003@v2、D-004@v2、D-005@v1、D-006@v2、D-007@v1）
- [x] 生命周期契约表（七事件，含 marker 型「无后端事件」显式行）
- [x] UI 原型分级核对：prototype-askuser-cards.html 已生成并经用户确认（场景三文案与 v2 纯前端机制一致——提交并发送即答案作消息）
- [x] Grill 复审（v2）通过：specVerdict=pass / qualityVerdict=pass；N1（input/editor 合成占位选项）N2（session_kind='group_member' 判别）N3（授权门锚 :949）N4/N5（best-effort 标注）已全部落入正文
- [x] Grill P0/P1/P2/P3 全部落解：P0-1→Wave B 纯前端化；P1-2→D-004@v2 授权放开；P1-3→questions[] 映射表；#16→driver-factory 注入；#17→测试路径勘正；#18→R-09；#8→引证勘正（真名 SessionDialogRequest/dialog_payload、codex L1823-1856）
- [x] 不确定问题标注：⚠️ 自审存疑——pi `editor` 大文本在移动端的呈现（编码期按 AskUserDialogCard 既有输入能力适配，不阻塞）
