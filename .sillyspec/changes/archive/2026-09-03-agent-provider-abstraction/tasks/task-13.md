---
id: task-13
title: '双路径渲染等价 fixture 测试（Claude 零回归判据）'
title_zh: '双路径渲染等价 fixture 测试（Claude 零回归判据）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts
  - frontend/src/components/agent-log/__tests__/fixtures/dual-path-session.json
  - frontend/src/lib/use-agent-run-stream.ts
  - frontend/src/lib/agent.ts
  - frontend/src/lib/__tests__/use-agent-run-stream.test.ts
  - frontend/src/components/agent-log/normalize.ts
goal: >
  Claude 零回归判据落地：同一事件序列生成的两种载荷（旧文本行 vs agent_event 行）分别过
  normalize 两条路径，断言渲染模型树等价（忽略 log_id/timestamp 等非渲染字段）（FR-04 /
  design §2 目标 2 可测定义）。附带：SSE 转换层接线——use-agent-run-stream.ts 的 onMessage
  逐字段构造行（task-10 发现的既有缺口：连 tool_kind/segment_id 也丢），补 agent_event
  （顺带 tool_kind/segment_id/edit_patch）透传，使实时流双轨真正可达。
implementation:
  - fixtures/dual-path-session.json：一段典型 Claude 会话（assistant 文本/thinking/tool_use+result 配对/子代理归属行/Edit patch/turn result），同时存两种载荷形态（由 task-12 的 backend 落库产物导出或手工构造对齐）
  - normalize-dual-path.test.ts：两种载荷分别 normalize → 深比较渲染模型树（剥离 log_id/timestamp/dedup_key 后结构等价断言）；覆盖含 partial+override 的流式段落
acceptance:
  - 双路径渲染模型树等价断言通过（Claude 零回归判据，design §2 目标 2）
  - 覆盖子代理行与 Edit patch 行（深功能不降级证明）
verify:
  - cd frontend && pnpm exec vitest run src/components/agent-log/__tests__/normalize-dual-path.test.ts
constraints:
  - 纯测试任务：发现不等价=task-10 实现 bug 回修，不在本 task 改 normalize 生产码
  - fixture 与 task-12 脱敏要求一致
  - 忽略字段白名单固定（log_id/timestamp/dedup_key/segment_id），其余字段全比
expects_from:
  - task-10: normalize 双轨实现
  - task-12: fixture 事件序列来源
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
