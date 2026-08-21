---
id: task-09
title: user-turn-input-attachments-and-inject-consumption
title_zh: UserTurnInput 附件扩展与 inject 消费改造
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P0
depends_on: [task-07]
blocks: [task-10]
requirement_ids: [FR-2, FR-4, FR-5]
decision_ids: [D-2, D-4]
allowed_paths:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/interactive/session-manager-attachments.test.ts
provides:
  - contract: UserTurnInputAttachments
    fields: [blocks, filesToFetch]
expects_from:
  task-07:
    - contract: SessionInjectAttachment
      needs: [id, kind, media_type, name, bytes, data, object_key]
goal: >
  扩展 UserTurnInput 承载多模态 blocks 与待落盘 filesToFetch，并在 SessionManager inject 消费
  SESSION_INJECT attachments——图片/PDF 转 blocks（内联 data 或 D-4 回拉后转块）、
  kind=file 经 hub-client 下载落 cwd/attachments/ 同名加序号 + prompt 追加路径清单、
  单文件下载失败降级标注不中断 turn。
implementation:
  - UserTurnInput 扩展落在 driver.ts（grep 证实其定义实际在 src/interactive/driver.ts，design §6.1 标注 types.ts 与现状不符）——新增可选 blocks（image{mediaType,base64} / document{mediaType 固定 application/pdf,base64}）与可选 filesToFetch（id+name 数组），纯文本路径零改动
  - types.ts 导出协议附件项的归一化类型（snake_case media_type/object_key/data 到 daemon 内部 camelCase 的映射产物），供 daemon.ts 路由与 SessionManager 消费共用，转换职责归本任务
  - hub-client.ts 新增 downloadSessionAttachment 单附件下载方法返回 Buffer——完全复刻 getSpecBundle 二进制 GET 模式（X-API-Key/Bearer 鉴权、AbortSignal.timeout、非 2xx 抛 HubHttpError、arrayBuffer 转 Buffer），端点 GET /api/daemon/session-attachments/<id>/content
  - SessionManager.inject 增加可选附件参数（归一化附件数组 + 可选下载闭包）；daemon.ts _routeSessionControl 的 SESSION_INJECT 分支读 raw.attachments 归一化后透传，下载闭包用 daemon 既有 hub client 构造——cli.ts 的 SessionManager 构造点零改动
  - 消费路由按 media_type 判定——application/pdf 转 document 块、image/* 转 image 块（data 非空直接用，为空走 D-4 回拉模式经下载闭包取字节转 base64 再成块，回拉失败同降级标注）；其余进 filesToFetch
  - filesToFetch 逐个下载写入 <state.cwd>/attachments/<name>（子目录递归创建，文件名取 basename 防路径穿越），同名冲突加序号自 1 递增直到不冲突且保留扩展名
  - 全部落盘尝试完成后 prompt 尾部追加路径清单——头行为附件已落盘提示行（可用 Read/Grep 等工具读取）加每文件一行 attachments/ 相对路径；失败文件以「(下载失败: xxx)」标注；最终组一条含 blocks 与追加后 text 的 UserTurnInput push 进 state.inputQueue，currentRunId/status/排队计数既有逻辑不动
acceptance:
  - SESSION_INJECT 带 attachments 时图片/PDF 生成 blocks——内联 data 直转，data 为空经 GET content 回拉后转 blocks
  - kind=file 落盘 <cwd>/attachments/<name>；同名文件连续两轮 inject 得到原名与加序号名两个文件互不覆盖
  - 单文件下载失败时该文件跳过、prompt 含下载失败标注、inputQueue 仍 push 该 turn（不抛错不中断）
  - 不带 attachments 的 SESSION_INJECT 与现状行为完全一致（inject 旧三参调用零回归）
  - 新增 vitest 用例（mock 下载闭包与 hub client）覆盖上述四类场景
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - blocks 为 daemon 内部 camelCase 形态；协议层 snake_case 到 camelCase 的转换只在本任务消费处做，不得反向改动 protocol.ts（task-07 所有）
  - codex 会话由 backend 422 加前端门控双保险，daemon 侧 codex driver 天然只读 text 忽略 blocks 作兜底，本任务不改 codex-app-server-driver.ts
  - 下载仅走 hub-client 既有 apiKey 凭证通道（X-005），不新增鉴权面；路径清单用相对 attachments/ 前缀，绝对路径不进 prompt
  - 与 task-10 的边界——本任务只产出 blocks 数据形态，块数组到 SDK ContentBlockParam 的映射归 task-10
related_tests:
  - sillyhub-daemon/tests/interactive/session-manager-attachments.test.ts
---
