# 会话附件：图片多模态 + 文件落盘（2026-08-20-session-multimodal-attachments）

> 方案 A 引用式（用户已确认）。参考 E:/Deepseek/deepseek-harness attachment 能力族
> （ImageAttachmentRef / Limits / 内容寻址存储 / 草稿不落库提交时持久化）。

## 1. 背景与目标

/sessions 会话现只能发纯文本。用户要求：①图片附件走多模态（模型直接看图）；
②文件附件让 agent 可消费。多模态对 Claude Code 生态是刚需（截图报错、设计稿比对、
日志文件分析等场景）。

可行性已核实：
- Claude Agent SDK `SDKUserMessage.message.content` 支持 `ContentBlockParam` 数组
  （`ImageBlockParam` base64 / `DocumentBlockParam` PDF）——sdk.d.ts:4127 +
  @anthropic-ai/sdk messages.d.ts:527/582。
- daemon `mapUserTurnInputToSdk`（claude-sdk-driver.ts:298）现只发 `content: turn.text`
  纯字符串——改造点明确。
- backend 已有 `modules/storage`（StorageBackend：put/get_stream/delete/head，
  MinIO 实现）——存储零新建。
- codex driver 是 flat message 协议，不支持多模态——需门控。

## 2. 范围与总体方案

**方案 A 引用式（用户确认）**：选文件即上传 MinIO 得 attachment_id（内容寻址 + 元数据行）；发消息 inject 带 id——图片/PDF backend 预读 base64 内联下发（总量 8MB 闸门，超限 daemon 回拉），daemon 转 SDK 多模态块；其他文件 daemon 下载落会话 cwd/attachments/ 供工具消费；历史回显走 user_input 标记行 + 按 id 拉存储。范围 = FR-1~FR-9（见下节）；非目标（附件加密 / 对象 GC 自动化 / codex 多模态 / 附件版本）见 proposal.md。

## 3. 需求（FR）与约束（设计范围）

| # | 需求 | 说明 |
|---|------|------|
| FR-1 | 图片上传与预览 | 输入栏选图（png/jpeg/webp/gif），即传即预览（缩略图 chip，可删） |
| FR-2 | 图片多模态注入 | 发送时模型直接看到图片内容（ImageBlock base64） |
| FR-3 | 文件上传 | 任意类型文件（≤20MB），chip 预览可删 |
| FR-4 | 文件落盘供 agent 消费 | daemon 下载到会话 `cwd/attachments/`，提示词附路径清单；agent 用 Read/Grep 等工具读 |
| FR-5 | PDF 多模态直读 | PDF 走 DocumentBlockParam（模型直接读，无需工具） |
| FR-6 | 历史回显 | 重进会话后图片显缩略图、文件显 chip（从存储拉取） |
| FR-7 | 引擎门控 | codex 会话隐藏/禁用附件入口 |
| FR-8 | 双侧限制校验 | 前端体验预检 + backend 权威校验 |

限制（参考 harness ImageAttachmentLimits，前后端同源常量）：
- 图片：png/jpeg/webp/gif，单张 ≤5MB，每消息 ≤5 张；
- 文件：单份 ≤20MB，每消息 ≤5 份；
- 超限 4xx 明确报错（不静默丢）。

## 3.1 FR-10 多模态能力门控与降级（用户 2026-08-20 补充需求）

**问题**：并非所有模型都支持图片/PDF 直读（如 GLM-4.5 文本版）。向非多模态模型
发 ImageBlock：Anthropic 兼容端点 400（如 bigmodel anthropic 端点 + glm-4.5）
或中转站静默丢图（更危险，模型「假装看了」）。

**能力判定（D-9）**：`llm_providers` 表加 `multimodal` 三态字段
（`auto`/`true`/`false`，默认 `auto`）：
- `auto`：按当前生效模型名启发式推断（`*-v`/`*-vl`/`*vision`/`glm-*-v*`/
  `gpt-4o*`/`gpt-5*`/`o4*`/`claude-*`/`gemini-*`/`qwen*vl*` 等前缀/后缀表）；
  中转站别名命中不了 → 视为**不支持**（保守侧，宁降级不硬失败）。
- 用户可在供应商表单手动覆盖（中转站别名场景的权威来源）。

**降级语义（D-9）**：inject 组装时按会话当前生效 provider 判定——
- 支持多模态：图片/PDF 走 base64 内联（原 FR-2/FR-5 链路）；
- 不支持：图片/PDF **自动降级为文件落盘模式**（daemon 下载到 cwd/attachments/ +
  路径清单），prompt 注明「当前模型不支持图片直读，图片已落盘」，turn 不失败；
- 前端发送前拉 provider multimodal 状态，附件区明示降级模式（黄色提示条），
  用户知情但无需手动选（自动降级，无感安全）。
- 降级模式下图片对模型不可读（文本模型看不了图）——这是模型能力边界，
  落盘至少保证：文件不丢、agent 知道存在、转发/上传等操作仍可执行。

**注意**：会话级选择的供应商（session_llm_provider_id）与档案绑定供应商优先于
全局默认（既有 lease 优先级链），判定取会话本轮实际生效的 provider。

## 4. 设计——数据模型

### 文件变更清单

新增（backend）：
- backend/app/modules/session_attachment/__init__.py
- backend/app/modules/session_attachment/model.py
- backend/app/modules/session_attachment/storage.py
- backend/app/modules/session_attachment/schema.py
- backend/app/modules/session_attachment/service.py
- backend/app/modules/session_attachment/router.py
- backend/app/modules/session_attachment/capability.py
- backend/app/modules/session_attachment/cleanup.py
- backend/app/modules/session_attachment/tests/（__init__.py、conftest.py、test_router.py、test_inject_attachments.py、test_draft_cleanup.py）
- backend/migrations/versions/<新迁移>.py（session_attachments 表 + llm_providers.multimodal 列）

修改（backend）：
- backend/app/modules/llm_provider/model.py（multimodal 列）
- backend/app/modules/llm_provider/schema.py（Read 暴露 multimodal）
- backend/app/modules/daemon/schema.py（SessionInjectRequest.attachment_ids）
- backend/app/modules/daemon/session/service.py（inject 校验/组装下发/标记行）
- backend/app/main.py（路由注册 + 清理任务挂载）

新增（daemon）：
- sillyhub-daemon/tests/interactive/session-manager-attachments.test.ts

修改（daemon）：
- sillyhub-daemon/src/protocol.ts（SessionInjectPayload.attachments）
- sillyhub-daemon/src/interactive/driver.ts（UserTurnInput blocks/filesToFetch）
- sillyhub-daemon/src/interactive/session-manager.ts（inject 消费/下载落盘）
- sillyhub-daemon/src/interactive/claude-sdk-driver.ts（mapUserTurnInputToSdk 块数组）
- sillyhub-daemon/src/daemon.ts（WS 路由透传 attachments）
- sillyhub-daemon/src/hub-client.ts（附件下载方法）

新增（frontend）：
- frontend/src/lib/api/session-attachments.ts
- frontend/src/components/daemon/__tests__/session-input-bar-attachments.test.tsx
- frontend/src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx
- sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts

修改（frontend）：
- frontend/src/lib/api-types.ts（pnpm gen:types 生成）
- frontend/src/lib/daemon.ts（injectSession 透传）
- frontend/src/lib/api/llm-providers.ts（multimodal 透出）
- frontend/src/app/(dashboard)/sessions/page.tsx（附件状态接线）
- frontend/src/components/daemon/session-input-bar.tsx（附件 UI）
- frontend/src/components/llm-providers/llm-provider-form.tsx（multimodal 开关）
- frontend/src/components/daemon/turn-timeline.tsx（标记行渲染）
- frontend/src/components/daemon/runtime-session-helpers.tsx（标记解析纯函数）
- frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx（props 扩展断言同步）

新表 `session_attachments`（Alembic 单迁移）：

```python
class SessionAttachment(...):
    id: uuid PK
    user_id: uuid FK users（归属）
    session_id: uuid | null FK agent_sessions（null=草稿未发送）
    kind: str  # "image" | "file"
    media_type: str
    bytes: int
    name: str  # 展示名（剥本地路径）
    object_key: str  # attachments/{user_id}/{sha256}.{ext} 内容寻址
    sha256: str
    width: int | null   # 图片专用
    height: int | null
    created_at: timestamptz
```

索引：`(user_id, session_id)`、`(session_id)`。软删不需要（附件不可变，删除即
delete 行 + 对象；同 sha256 多行共享对象时按引用计数决定是否删对象——V1 简化：
对象不删，只删行，孤儿对象由清理任务兜）。

## 5. 设计——backend（modules/session_attachment + inject 扩展）

### 4.1 端点（前缀 /api/daemon/session-attachments，归属校验同会话资源 404 隐藏语义）

- `POST /`（multipart：file + kind）→ 校验限制（图片 PIL 读宽高 + magic 校验
  media_type 真实性）→ sha256 → `put_object` → 建行 → `AttachmentRead`。
  同 user 同 sha256 已存在 → 复用对象（新行同 object_key）。
- `GET /{id}/content` → 归属校验 → 流式回字节（Cache-Control: immutable +
  ETag=sha256——内容寻址天然可长缓存）。
- `DELETE /{id}` → 仅草稿（session_id null）可删；已绑定消息的附件不可删。

### 4.2 inject 扩展（daemon/schema.py SessionInjectRequest）

新增 `attachment_ids: list[uuid] = []`。service 层：
1. 批量查行校验：归属（user_id）+ 限制（张数/大小）+ kind 分组；
2. 回填 session_id（发送即绑定，草稿→持久语义，对齐参考"提交时持久化"）；
3. 图片/PDF：读 MinIO → base64 → 组装进 SESSION_INJECT payload `attachments`；
4. 其他文件：payload 只带元数据（id/name/bytes/media_type），daemon 自行经
   `GET /{id}/content`（hub-client 带 daemon 凭证）下载落盘；
5. user_input 日志 content 头部插标记行：`[附件:{id}|{kind}|{name}]`（每附件一行，
   换行后接原 prompt）——历史回显的数据源，零新列。

### 4.3 SESSION_INJECT payload 扩展（sillyhub-daemon/src/protocol.ts）

```ts
interface SessionInjectPayload {
  // …既有字段不动…
  // 命名对齐协议层 snake_case 逐字对齐惯例（protocol.ts 既有约定；
  // daemon 侧内部转 camelCase 由消费处自理）
  attachments?: Array<{
    id: string;
    kind: "image" | "file";
    media_type: string;
    name: string;
    bytes: number;
    /** image / pdf：backend 预读 base64（D-4 总量闸门内联）；回拉/文件模式下空。 */
    data?: string;
    /** 回拉/文件模式：daemon 经 GET /content 自行下载。回拉所得 image/pdf 仍转
     *  blocks（多模态消费），仅 kind=file 落盘 cwd/attachments/。 */
    object_key?: string;
  }>;
}
```

旧 daemon 收到多余字段忽略（协议向后兼容，零破坏）。

### 4.4 草稿清理

挂现有 DaemonService cron 委托机制（同 lease expiry 批处理模式）：
每小时删 `session_id IS NULL AND created_at < now()-48h` 的行（对象同 4.1 简化不删）。

## 6. 设计——daemon（sillyhub-daemon）

### 5.1 消息模型（types.ts UserTurnInput）

```ts
interface UserTurnInput {
  type: "user";
  text: string;
  /** ql-attachments：多模态块（图片/PDF），driver 转 SDK ContentBlockParam。 */
  blocks?: Array<
    | { type: "image"; mediaType: string; base64: string }
    | { type: "document"; mediaType: "application/pdf"; base64: string }
  >;
  /** ql-attachments：需落盘的文件（daemon 下载到 cwd/attachments/）。 */
  filesToFetch?: Array<{ id: string; name: string }>;
}
```

### 5.2 inject 消费（daemon.ts → SessionManager）

收到 SESSION_INJECT：payload.attachments 图片/PDF → blocks；其他文件 →
hub-client `GET /api/daemon/session-attachments/{id}/content` 下载至
`{cwd}/attachments/{name}`（同名冲突加序号），全部落盘后 prompt 追加：

```
[附件已落盘，可用 Read/Grep 等工具读取]
- attachments/xxx.log
```

下载失败：该文件跳过 + prompt 标注「(下载失败: xxx)」，turn 不中断。

### 5.3 mapUserTurnInputToSdk（claude-sdk-driver.ts）

`content` 由纯字符串改块数组（text 块 + image/document 块）；**无 blocks 时保持
原纯字符串路径零回归**（既有测试全绿即证明）。codex driver：不读 blocks
（backend 已拒 + 前端门控双保险，driver 层再静默忽略兜底）。

## 7. 设计——前端（frontend/src）

### 6.1 SessionInputBar（components/daemon/session-input-bar.tsx）

- 📎 按钮（下拉或直接双 accept：`image/*` + 全类型）：codex 会话禁用（prop
  `attachmentsDisabled`，先例：供应商锁定）；
- 选文件即传（POST multipart）→ chips 区渲染（图片缩略图 / 文件名+大小），
  可删（DELETE）；上传中 spinner、失败红 chip 可重试；
- 发送：inject 带 attachment_ids；成功后清 chips。

### 6.2 历史回显（turn-timeline 用户气泡）

logsToTurns 已把 user_input 行提为 prompt——在 prompt 渲染前解析 `[附件:id|kind|name]`
标记行：图片 → `GET /{id}/content` 缩略图（点击新窗看大图）；文件 → 只读 chip
（文件名+大小）。解析失败的标记行按原文本显示（容错）。

### 6.3 api-types

`pnpm gen:types` 重新生成（规则 21），AttachmentRead 等走生成类型。

## 8. 设计——测试

- backend pytest：上传校验（类型/大小/张数/归属 404）、sha256 去重复用、
  inject 组装（payload attachments 正确、user_input 标记行）、草稿删除/已绑定拒删、
  清理任务。
- daemon vitest：mapUserTurnInputToSdk 块数组（有/无 blocks 两路径）、文件下载
  落盘 + prompt 追加、下载失败降级。
- frontend vitest：输入栏附件流（选→传→chip→删→发送带 ids）、codex 禁用、
  历史标记行解析渲染。
- E2E 手工验收：真图发送模型能描述内容；文件发送 agent 能 Read；重进回显。

## 9. 风险与决策记录

| # | 决策 | 理由 |
|---|------|------|
| D-1 | 图片 base64 由 backend 预读下发，daemon 不回拉 | 省一跳往返；但 SESSION_INJECT 经 Redis→WS 中转，帧必须控量（见 D-4） |
| D-2 | 文件落 cwd/attachments/ 而非多模态 | Claude Code 生态工具消费最自然；大文件多模态不可行 |
| D-3 | 标记行进 user_input 日志而非新 DB 列 | 零迁移回显；日志本就是回显数据源 |
| D-4 | 帧总量闸门：payload 内联 base64 总量 >8MB → 全部附件改 daemon 回拉模式（payload 只带元数据+objectKey） | WS/Redis 单帧保护；按总量而非单张判定（5×7MB 内联=35MB 单帧不可接受）。单张也 >8MB 时同走回拉 |
| D-5 | 对象不删只删行 | 不可变内容寻址对象共享；孤儿由清理任务兜（V1 简化，accepted risk：存储只增不减） |
| D-6 | codex 不支持附件 | flat 协议无多模态；三层门控：前端禁用入口 + backend `session.provider != "claude"` 携附件 inject → 422（错误码 HTTP_422_SESSION_ATTACHMENTS_UNSUPPORTED）+ driver 静默忽略兜底 |
| D-7 | 带附件时允许空 prompt | 「看图说话」场景：attachment_ids 非空时豁免空 prompt 校验（对齐 ql-20260817-010 静默切换的豁免先例）；纯文本仍要求非空 |
| D-8 | 附件生命周期独立于会话软删 | 归属校验只查 user_id；会话删除后历史日志标记仍可回显（附件行与对象保留） |
| D-9 | 多模态能力门控 + 自动降级：provider.multimodal 三态（auto 启发式/手动覆盖，别名未知=不支持）；不支持时图片/PDF 降级文件落盘模式 | 用户指出并非所有模型多模态（GLM 文本版 400）；保守判定宁降级不硬失败；中转站别名靠手动覆盖 |

## 10. 设计——生命周期契约表（附件）

| 实体 | 状态/阶段 | 触发 | 迁移 | 终态与清理 |
|---|---|---|---|---|
| 附件行（draft） | `session_id=null` 草稿 | 前端选文件上传成功 | 发送消息（inject 校验通过）→ 回填 session_id 变 bound | 48h 未发送 → 清理任务删行（对象保留，D-5）；用户手动 DELETE 删行 |
| 附件行（bound） | `session_id` 已绑定 | inject 成功 | 不可再删（DELETE 拒绝）、不可变更（不可变模型） | 随 DB 长存（D-8：独立于会话软删） |
| MinIO 对象 | 不可变 | 上传时 put_object（内容寻址 sha256 键） | 无状态迁移（同 sha256 复用） | V1 永不删除（D-5 accepted risk：存储只增） |
| inject 附件引用 | 请求态 | POST /inject 携 attachment_ids | 校验（归属/限制/引擎）失败 → 4xx 整体拒绝（不部分生效）；通过 → 组装下发 + 标记行入 user_input 日志 | 随 AgentRun 日志持久（回显数据源） |
| daemon 落盘文件 | 会话 cwd/attachments/{name} | 收到 SESSION_INJECT filesToFetch → 下载 | 同名冲突加序号；下载失败单文件降级（标注，turn 不中断） | 随会话目录（cwd 生命周期即会话生命周期，不额外清理） |
| 历史标记行 | user_input 日志 content 头部 | inject 组装时写入 | 无（不可变日志） | 随日志；前端解析失败按原文显示（容错） |

状态机要点：draft →（inject 成功）→ bound 是唯一前进迁移；无回退、无重绑定
（同一附件行可再次被后续消息引用——引用不改变 bound 状态，只读）。

## 11. Grill 交叉审查记录（2026-08-20，tier=self）

| ID | 层级 | 交叉点 | 结论 | 处置 |
|---|---|---|---|---|
| X-001 | consistency | D-1 内联策略 vs WS/Redis 帧上限（5×7MB=35MB 单帧不可接受） | conflict | D-4 修正为按 payload 总量 8MB 闸门 |
| X-002 | definition | 纯附件消息空 prompt 是否允许 | 未定义 | D-7 新增：附件非空豁免空 prompt |
| X-003 | definition | codex 门控的 backend 拒绝行为 | 未定义 | D-6 补 422 错误码 |
| X-004 | boundary | 会话软删后附件可读性 | 未定义 | D-8 新增：生命周期独立 |
| X-005 | feasibility | daemon 下载文件鉴权 | hub-client 既有 apiKey 通道（litellm_proxy 同模式） | 无需改 |
| X-006 | consistency | 用户 prompt 含伪标记文本 | UUID 正则锚定解析，误报率可忽略 | 无需改 |

已知残留：①附件内容不加密（MinIO 私有桶 + 归属校验，与文件中心同安全模型）；
②daemon 下载文件走 hub 公网地址——复用既有 hub-client 凭证通道，无新增暴露面。
