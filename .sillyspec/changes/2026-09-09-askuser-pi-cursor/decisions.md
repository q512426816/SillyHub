---
author: qinyi
created_at: 2026-09-09 22:20:53
---

# 决策记录 — 2026-09-09-askuser-pi-cursor

> brainstorm step3/step4 用户拍板 + 探索结论收敛。格式：D-xxx@vN + supersedes；九字段 + 可选锚点/模块域/否决理由/复潮条件。

- **D-001@v1**
  - type: process
  - status: confirmed
  - source: user
  - question: AskUser 通道（pi/cursor/群聊）拆几个变更交付？
  - answer: 一个变更三波（Wave A pi 桥接 / Wave B cursor 标记协议 / Wave C 群聊聚合），共用一份四件套与统一协议层。
  - normalized_requirement: 单变更内按 Wave 分批交付，三波可独立验收但设计/协议一份。
  - impacts: plan.md Wave 划分、tasks 任务分组、验收按波分节。
  - evidence: brainstorm step3 用户选择（2026-09-09，备选"拆两个/三个变更"被否）。
  - priority: P1
  - 锚点: .sillyspec/changes/2026-09-09-askuser-pi-cursor/design.md §拆分判断
  - 模块域: sillyspec

- **D-002@v1**
  - type: architecture
  - status: confirmed
  - source: user+exploration
  - question: pi 提问通道的技术形态与超时语义？
  - answer: pi `extension_ui_request` 提问类（select/confirm/input/editor）映射平台 AgentSessionDialog（照 codex `request_user_input` 模板，dialog_kind 新增 pi 变体），答案 denormalize 回 pi RPC；对齐平台既有「dialog 永久等待不超时」语义（不引入 30min 定时器），会话中止/驱动 close 兜底回 cancelled；权限类 extension_ui_request 继续自动拒绝（安全红线）。
  - normalized_requirement: pi 轮中阻塞提问；永久等待；中止兜底；权限类零桥接。
  - impacts: pi-rpc-driver、session-manager（复用 requestUserDialog 路径）、pi 会话 permission_dialog 翻真。
  - evidence: 模块文档 sillyhub-daemon.md L47（dialog 不超时语义）；codex-app-server-driver L1823-1856 模板（Grill 勘正行号）；pi-onboarding design L66/L94（「桥接留后续」）。
  - priority: P0
  - 锚点: sillyhub-daemon/src/interactive/pi-rpc-driver.ts:796（dialog 自动取消点）
  - 模块域: sillyhub-daemon

- **D-003@v1**
  - type: architecture
  - status: confirmed
  - source: user
  - question: cursor 无 CLI 对话通道，提问怎么做？遵守率不达标怎么办？
  - answer: 轮界文本标记协议（askuser JSON 尾块）：轮尾解析剥离→统一载荷→平台 dialog；答案自动组装下一条用户消息 `--resume chatId` 续轮；解析器放协议公共层引擎无关。先 spike 验证模型遵守率，不达标则标记协议只留设计接口不交付，cursor 降级自然语言提问。
  - normalized_requirement: cursor 提问走标记协议；spike 为 go/no-go 门槛；降级路径内置。
  - impacts: cursor-driver 轮尾、公共层解析器、prompt 注入、前端答案自动发送与标记隐藏。
  - evidence: brainstorm step3 用户选择（2026-09-09）；parseAttachmentMarkers 前端标记先例。
  - priority: P0
  - 锚点: sillyhub-daemon/src/interactive/cursor-driver.ts
  - 模块域: sillyhub-daemon, frontend

- **D-004@v1**
  - type: product
  - status: confirmed
  - source: user
  - question: 群聊里 agent 提问后谁能作答？
  - answer: 任何群成员可答、先到先得（后答者见已关闭态）；agent 可经提示词给出「推荐回答人」（艾特提示），卡片渲染 @推荐，软提示非硬门控。
  - normalized_requirement: 群聊答题先到先得 + 可选 recommendResponders 推荐字段入统一协议。
  - impacts: 统一载荷字段、群聊聚合卡渲染、提示词约定。
  - evidence: brainstorm step3 用户选择（2026-09-09，"仅定向人可答"被否）。
  - priority: P1
  - 锚点: frontend/src/components/group-chat/group-chat-panel.tsx
  - 模块域: frontend, sillyhub-daemon

- **D-005@v1**
  - type: architecture
  - status: confirmed
  - source: user+exploration
  - question: 后续新引擎接入是否每次重写提问功能？
  - answer: caps 三端对齐表新增 `dialog: 'native' | 'marker' | 'none'` 能力位；native→抄 codex/pi 桥接模板，marker→零代码配提示词复用公共解析器，none→不渲染提问入口。
  - normalized_requirement: 能力声明驱动路径选择，标记解析器引擎无关。
  - impacts: providers.ts / provider_caps.py / provider-caps.ts + 三端联动测试。
  - evidence: 探索阶段 caps 机制调研（providers.ts L33-35 现有 multimodal/thinking 先例）。
  - priority: P1
  - 锚点: sillyhub-daemon/src/interactive/providers.ts
  - 模块域: sillyhub-daemon, backend, frontend

- **D-006@v1**
  - type: architecture
  - status: confirmed
  - source: exploration
  - question: 平台中间管道（提交/持久化/渲染/回流）是否改动？
  - answer: 零改动全复用：handle_permission_request 提交通道、AgentSessionDialog 持久化、SSE 广播、AskUserDialogCard（provider 无关）、PERMISSION_RESPONSE 回流。
  - normalized_requirement: 新增代码集中在各引擎端头适配器 + 群聊聚合 + caps 三端表。
  - impacts: 文件变更清单范围控制。
  - evidence: ask-user-dialog-card.tsx 文件头「provider 无关」；daemon/model.py AgentSessionDialog 通用结构。
  - priority: P0
  - 锚点: frontend/src/components/ask-user-dialog-card.tsx:2
  - 模块域: frontend, backend

- **D-007@v1**
  - type: architecture
  - status: confirmed
  - source: user
  - question: 端头组织架构选 A（驱动直挂同构）/B（DialogGateway 单点）/C（全标记协议）？
  - answer: 方案 A：pi 在驱动内拦 extension_ui_request 经 session-manager 现成 requestUserDialog 路径上抛（codex 同构）；cursor 公共层标记解析器 + 驱动轮尾调用；群聊前端聚合。零新抽象、回归风险最低。
  - normalized_requirement: 与 claude/codex 既有结构同构，不引入网关层，不动既有引擎路径。
  - impacts: 总体方案结构；B 否决理由=既有路径迁移/双轨风险；C 否决理由=pi 体验降级且违反 D-002。
  - evidence: brainstorm step4 用户选择「A」（2026-09-09）。
  - priority: P0
  - 否决理由: （B）DialogGateway 需迁移或双轨 claude/codex 既有路径，动面与回归风险大于收益；（C）放弃 pi 原生轮中阻塞、违反 D-002。
  - 复潮条件: （B）引擎数 ≥5 且桥接逻辑出现三处以上复制粘贴时重议；（C）pi RPC dialog 通道在实测中不可用时重议。
  - 锚点: sillyhub-daemon/src/interactive/session-manager.ts:676
  - 模块域: sillyhub-daemon, frontend

- **D-003@v2**
  - type: architecture
  - status: confirmed
  - supersedes: D-003@v1
  - source: design-grill
  - question: Grill P0-1：v1 的「轮尾解析剥离→平台 dialog→turn completed 与 dialog pending 并存」被 backend 三处 run 存活不变量否决（permission_service.py L415-431 提交需活跃 run / L719-724 终态 run 孤儿卡过滤 / L989-994 答题需活跃 run），怎么办？
  - answer: 改纯前端标记渲染协议：标记随消息文本原样持久化（标记即数据，不剥离、不建 pending 行、不经 answer 端点）；前端解析渲染提问卡（单聊 turn-timeline + 群消息行同解析器）；提交=答案组装为下一条用户消息走既有发送链路；已答态=本地判定（轮后存在用户消息）；daemon 侧仅 prompt 注入。spike 门槛与降级路径不变。
  - normalized_requirement: cursor 提问零后端 dialog 依赖；绕开全部 run 存活不变量；渲染/持久化一致性靠「标记即数据」。
  - impacts: Wave B 文件清单（删 daemon 解析器/轮尾接线，增前端 lib+卡片）；生命周期契约表 marker 行改「无后端事件」；R-04 重写。
  - evidence: design.md v2 §Wave B；Grill 审查报告（brainstorm-review-2026-09-09-222343）P0-1。
  - priority: P0
  - 锚点: frontend/src/lib/askuser-marker.ts
  - 模块域: frontend, sillyhub-daemon

- **D-004@v2**
  - type: product
  - status: confirmed
  - supersedes: D-004@v1
  - source: user+design-grill
  - question: Grill P1-2：「任何成员先到先得作答」与影子会话 owner/admin-only 答题授权（shadow.py:478 + permission_service.py:1119-1123）冲突，收窄还是放开？
  - answer: 维持用户拍板的「任何群成员可答」——后端放开影子会话答题授权（双条件：群聊影子会话 + 答题者为该群成员），answered_by 修正为实际答题人；单聊授权语义不变。cursor marker 卡不受影响（发消息即答，天然先到先得）。
  - normalized_requirement: 影子会话 dialog answer 群成员放行 + answered_by 实际答题人 + 越权反例覆盖。
  - impacts: permission_service.py 入文件清单（打破 v1 零后端改动——见 D-006@v2 例外）；群聊关闭态显示实际答题人。
  - evidence: 用户 brainstorm step3 拍板「任何成员都可以答」；Grill P1-2；用户未能否决（2026-09-09 返工时按既定意向推进，可否决）。
  - priority: P1
  - 锚点: backend/app/modules/daemon/permission_service.py:949（真实授权门 _get_owned_session_for_update→helpers.py:357-359 影子分支；Grill N3 勘正）
  - 模块域: backend, frontend

- **D-006@v2**
  - type: architecture
  - status: confirmed
  - supersedes: D-006@v1
  - source: design-grill
  - question: v1「中间管道零改动」在 D-004@v2 授权放开下如何自洽？
  - answer: dialog 管道的提交/持久化/SSE/回流协议仍零改动复用；唯一例外=影子会话答题授权放开 + answered_by 归属修正（permission_service.py 授权分支小改，用户既定产品行为所必需）；caps 三端表与对齐测试解析器扩展属声明层非管道层。
  - normalized_requirement: 管道协议零变更；授权分支例外一处；caps 声明层三端。
  - impacts: 文件清单含 permission_service.py（授权分支）；兼容策略注明该例外可独立回退。
  - evidence: Grill P1-2；D-004@v2。
  - priority: P0
  - 锚点: backend/app/modules/daemon/permission_service.py
  - 模块域: backend
