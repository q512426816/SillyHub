---
id: task-10
title: '前端 normalize.ts 双轨（agent_event 优先/文本协议回退）'
title_zh: '前端 normalize.ts 双轨（agent_event 优先/文本协议回退）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/components/agent-log/__tests__/normalize.test.ts
goal: >
  前端渲染双轨：日志行携带 agent_event 字段 → 直接由结构化事件构造渲染模型（不进文本正则）；
  无该字段 → 回退现有 [ASSISTANT] 文本协议解析（FR-04 / D-001@v1）。Claude 渲染输出与现状等价。
implementation:
  - normalize.ts：行对象类型增可选 agent_event 字段（SSE payload 与回放接口两入口都识别）；新函数 fromAgentEvent(ev) → 渲染模型（type→渲染块映射：text→assistant、thinking→thinking、tool_use/tool_result→工具块（tool_name/call_id 配对/edit_patch 优先）、error、turn_result→result 块）；入口处 if (row.agent_event) 走新路径 else 旧文本解析（:112/560-564/593-600 现解析逻辑零改动）
  - tool_kind 渲染元数据复用现有 tool-kind-meta.ts（tool_name→kind 映射不变）
  - __tests__/normalize.test.ts：补 agent_event 路径用例（每型事件）；旧文本协议既有用例零改动（回退轨守护）
acceptance:
  - 带 agent_event 行走结构化路径；无字段行走旧路径（互不干扰）
  - 旧文本协议解析代码路径与断言零改动（回退轨不变）
  - typecheck/lint 绿；既有 normalize 测试零回归
verify:
  - cd frontend && pnpm exec vitest run src/components/agent-log/__tests__/normalize.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改渲染组件（agent-log-viewer/tool-renderers）——渲染模型形状与旧路径产出一致
  - 旧文本协议解析逻辑禁止顺手重构（双轨期冻结）
  - 日期格式化显式 zh-CN（仓库惯例）
expects_from:
  - task-07: SSE payload agent_event 字段（run/session 双通道）
  - task-09: 端到端上报形态定案
related_tests:
  - frontend/src/components/agent-log/__tests__/normalize.test.ts
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
