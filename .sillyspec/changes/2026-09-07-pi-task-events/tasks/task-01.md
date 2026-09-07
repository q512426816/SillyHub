---
id: task-01
title: 'PiEventNormalizer turnTask 状态机——派生规则实现（now 注入/防御补终态/异常隔离）'
title_zh: 'PiEventNormalizer turnTask 状态机——派生规则实现（now 注入/防御补终态/异常隔离）'
author: 'qinyi'
created_at: 2026-09-07 13:17:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-004@v1]
provides:
  - contract: agent_task_status_events
    fields: [running, terminal]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-events.ts
goal: >
  PiEventNormalizer 增实例级 turnTask 状态机（D-001 一轮一任务聚合 / D-002 归一化器内派生），从 pi 原始轮边界与工具事件流派生 status/agent_task_status 事件（task_id=pi-t<seq>），让 pi 会话任务执行面板每轮恰好一行有数据；既有映射表与内容事件产出零变化。
implementation:
  - 实例级私有状态 turnTask：taskId/toolUses/lastToolName/startedAtMs/running；task_id=pi-t<seq> 实例内单调递增；task_name 恒 '执行任务'（design 派生规则表：pi 无首轮摘要可提取，保守命名）；时间基准一律 this.now()
  - 时钟注入：构造器已支持 opts.now（ql-20260904-031 既有 `opts: { flushIntervalMs?, now? }`，pi-events.ts:119-122）——直接复用，勿重复加构造参数（design「now() 注入可测」意图已满足）
  - dispatch 增 case 'turn_start'（现落 default 零产出，:182-184）：建 running 任务行并产 status/agent_task_status(running)（status 先行）；若上轮任务仍 running（异常流：turn_end 丢失）先补发 completed（FR-03 防御，elapsed=now()-startedAtMs）再开新行；agent_settled 不触碰 turnTask（轮边界以 turn_start/turn_end 为准）
  - tool_execution_start（handleToolStart :314，dispatch :167 单事件包装改数组拼接）：last_tool_name=toolName、tool_uses+1，产 running 刷新事件（metadata.summary='正在调用 <toolName>'），status 事件先行、tool_use 内容事件随后；无 running 行时防御跳过派生
  - tool_execution_end 零任务事件（tool_uses 已在 start 计；工具成败≠任务成败，避免事件洪水）
  - turn_end（handleTurnEnd :353）：stopReason==='error' → failed（metadata.summary=errorMessage），否则（fixture 实证仅 'stop'；D-004：无 aborted→stopped 映射，被打断的轮按 completed 收行）→ completed；elapsed_ms=now()-startedAtMs；status 事件先行于既有 error/usage 内容事件；收行后清 turnTask；无 running 行防御跳过
  - 顶层 error / extension_error / ame.error：置 pendingError 记录、零事件产出（design 派生规则表：轮失败主要经 turn_end 浮出）
  - 派生推进整体 try/catch 隔离：任何异常仅 console.error 并跳过派生，原始内容事件照常返回（design 兼容策略降级条款）
  - 事件形状对齐 claude-events _normalizeTaskMessage 同构 metadata 键（claude-events.ts:663-797 先例）：task_id/task_name/status 必填 + last_tool_name/summary/elapsed_ms/tool_uses 可选（async 恒不传）；产出全部过 safeParseAgentEvent；既有映射表与公共签名 normalizeRpcLine(line: string): AgentEvent[] 零改动；ESM import 带 .js
acceptance:
  - turn_start → tool_execution_start×2 → turn_end(stop) 产出 running→刷新→completed 事件序列；tool_execution_end 零任务事件（FR-01）
  - turn_end(stopReason='error') 产 failed 且 summary=errorMessage；无 aborted 映射（FR-01/D-004）
  - 上轮未收 turn_end 时新 turn_start 先补 completed 再开新行；状态机任何异常不阻断原始事件流（FR-03）
  - 派生事件全部过 safeParseAgentEvent；非轮事件既有产出（错误路径/降级桶/坏行）零变化
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-events.test.ts
constraints:
  - 既有映射表（文件头注释表）与既有事件产出零改动——仅新增派生事件追加，status 先行
  - 公共 API 零变化：normalizeRpcLine 签名不变；构造器签名不变（now 已存在）
  - 不改 session-manager/cli/backend/前端（D-002 零侵入）；不动批量适配器 pi-json.ts
  - 禁跑全量测试；ESM import 带 .js 扩展名；Windows/Linux/macOS 兼容
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
