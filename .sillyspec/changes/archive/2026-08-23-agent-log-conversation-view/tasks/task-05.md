---
id: task-05
title: '前端 agent-log-card「查看内容」升级——直构段列表复用 tool-renderers 组件（tool_use_id 配对/失配「结果未记录」）+ 对话/原文切换 + 加载更早 + 全场景静默回落 + 组件测试'
title_zh: '前端 agent-log-card「查看内容」升级——直构段列表复用 tool-renderers 组件（tool_use_id 配对/失配「结果未记录」）+ 对话/原文切换 + 加载更早 + 全场景静默回落 + 组件测试'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: ['task-04']
blocks: ['task-06']
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-003@v1, D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/daemon/agent-log-card.tsx
  - frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
expects_from:
  task-04:
    - contract: readAgentLogMessages
      needs: [messages, truncated, total_segments]
# 嵌套字段需求（messages[].kind/tool_use_id/tool_input/tool_result/is_error/text/ts/seq）在 implementation/acceptance 里逐项断言，postcheck 字面匹配只对顶层字段。
goal: >
  agent-log-card「查看内容」面板对话化升级（design §5 步骤⑤ / §7.3 / §5.2，对照原型 prototype-agent-log-conversation-view.html）——status=parsed 时直构 NormalizedLogMessage 段列表渲染对话流（复用 agent-log/tool-renderers 导出组件，tool_use_id 配对、失配「结果未记录」），加「对话/原文」切换与「加载更早」；status≠parsed / HTTP 非 200 / 422（老 daemon）全场景静默回落原文 <pre>（黄条提示不弹错框），现状能力零损失。
implementation:
  - AgentLogEntry「查看内容」useEffect 升级双端点——展开先 readAgentLogMessages(entry.id)；HTTP 非 200（ApiError，含 422 老 daemon / 409 二进制 / 404 / 502/504）→ 静默转 readAgentLogContent 回落原文；200 但 status∈{unsupported, parse_error, too_large} → 同样回落，黄条注明回落原因（中文，参照原型 fb-note 文案，如「该格式暂不支持对话化解析，已回落原文尾部查看」）
  - status=parsed → 直构段列表渲染（不走 session-log-assembler，D-006@v1 Grill B2 裁决）——user_input → 用户气泡；reply → MarkdownText（@/components/ui/markdown-text，agent-log-viewer.tsx:25 同款）；thinking → CollapsibleSection 折叠；消息映射零协议文本合成
  - 工具段按 tool_use_id 显式配对（Map 索引，非位置配对）——由 NormalizedLogMessage 直接构造 ToolCallEntry 纯展示 DTO（agent-log/types.ts，timestamp/tool/args/status/success/rawArgs/toolUseId 直填），渲染复用 agent-log/tool-renderers 导出的 ToolCallPreview / ToolResultCard / CollapsibleSection（agent-log-viewer.tsx:25/56 同款导出）；tool_result 内容并入卡片结果区（mergedResult / ToolResultCard），is_error 着失败红
  - 配对失配（tool_use 无同 id 的 tool_result——窗口截断/中断）→ 渲染「结果未记录」中性徽章（muted/zinc 阶），禁止复用「执行中 ⏳」假运行语义（design §7.3 配对语义 / R-03）
  - 加载更早（design §5.2）——truncated=true 时面板顶部「加载更早」按钮（原型 .load-earlier），点击 readAgentLogMessages(entry.id, 当前最小 seq) 并把返回段前插列表；truncated=false 后隐藏按钮；辅以 total_segments 展示「共 N 段」截断说明（原型 .trunc-note）
  - 「对话 / 原文」tab 切换（parsed 态出现，原型 .tab）——原文 tab 懒调 readAgentLogContent 复用现有 <pre> 渲染（含「已截断至末尾 256KB」注明）；回落态无对话 tab，仅原文 + 黄条
  - 段时间戳 ts 用 new Date(ts).toLocaleString("zh-CN", …) 显式 zh-CN 语境渲染（CONVENTIONS 8，参照文件头 X-15 注释惯例）
  - 样式对照原型——用户气泡 / 思考折叠 / 工具卡 / 黄条回落提示均走双主题 brand-* 语义阶与主题 token，不硬编码 hex（CLAUDE.md 规则 20）；容器沿用面板既有 max-h/overflow 形态
  - 测试改写 + 新增（mock readAgentLogMessages）——① parsed 渲染：用户气泡 / MarkdownText 正文 / 思考折叠 / 工具卡展开输入与结果；② tool_use_id 配对 + 失配「结果未记录」（断言不出现「执行中」）；③ unsupported / parse_error / ApiError（HTTP 失败）/ 422 各自静默回落原文（断言 <pre> 出现 + 黄条提示，无 role=alert 红条）；④ 加载更早：truncated=true 按钮出现 → 点击带 before_seq → 更早段前插 → truncated=false 按钮消失；⑤ 对话/原文 tab 切换
acceptance:
  - parsed → 与平台会话「对话」视图同款交互的对话流：用户气泡 / MarkdownText 助手正文 / 思考折叠 / 工具卡片可展开输入与结果；DOM 无 system 提示词 / system-reminder 内容（R-04）
  - tool_use 与 tool_result 按 tool_use_id 配对；失配渲染「结果未记录」中性徽章，不出现「执行中 ⏳」
  - truncated=true 显示「加载更早」，点击携带 before_seq（当前最小 seq）且更早段前插；truncated=false 后按钮消失
  - unsupported / parse_error / too_large / HTTP 非 200 / 422 → 全部静默回落原文 <pre>（黄条提示），不弹错误框；回落态能力与现状一致（truncated 注明保留），不点新交互时既有行为零变化
  - 双主题（blue / ai-native）下 brand-* 语义阶随 html data-theme 换肤，无硬编码 hex
  - 既有「查看内容」用例按新交互改写后与新用例全部通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/agent-log-card.test.tsx
constraints:
  - 不 import session-log-assembler、不合成协议文本（design §3 非目标 / D-006@v1——其 AssemblerLogInput 无 kind 字段，且踩 AskUserQuestion 丢弃行与 seenText 同文去重两陷阱）
  - 配对失配渲染「结果未记录」中性徽章，禁止复用「执行中 ⏳」（已结束会话不得假运行）
  - 回落一律静默——黄条提示不弹错误框；role=alert 红条仅保留给现状「原文端点自身失败」既有错误态
  - Date.toLocaleString 显式传 "zh-CN"（CONVENTIONS 类型与数据契约 8）
  - 样式遵守双主题 brand-* 语义阶（CLAUDE.md 规则 20），对照原型 prototype-agent-log-conversation-view.html；不硬编码 hex
  - lib/agent-logs.ts / lib/query-keys.ts 不在本卡 allowed_paths——查看内容沿用组件内 useEffect 本地状态（既有 peek 模式），不改查询键、不改 API 封装
  - 不为凑绿改测试（规则 9）——既有断言改写仅限渲染升级导致的交互路径失效，断言语义（回落可用、失败可见）只强不弱
related_tests:
  - path: frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
    reason: 既有「查看内容」用例（约 :350-418——成功展开原文 <pre> 尾部文本 + truncated 注明 / 失败 ApiError 中文 message 直显红条 / 收起清态）基于「点按钮即 readAgentLogContent 原文直出」旧路径；本卡升级为先调 messages 端点、parsed 走对话渲染（<pre> 需切「原文」tab 才可见）、失败改静默回落黄条——断言需按新交互改写，并补 readAgentLogMessages mock（含 status 分层与 ApiError 两通道）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
