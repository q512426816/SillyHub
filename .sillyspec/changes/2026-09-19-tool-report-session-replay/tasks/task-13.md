---
id: task-13
title: 'cursor IDE 409 死胡同提示改善 + docs/sillyspec 跨仓跟进记录'
title_zh: 'cursor IDE 409 死胡同提示改善 + docs/sillyspec 跨仓跟进记录'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-006@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/agent-log-card.tsx
  - NEW:docs/sillyspec/cursor-agent-transcript-report-pipeline.md
target_files:
  - frontend/src/components/daemon/agent-log-card.tsx
  - NEW:docs/sillyspec/cursor-agent-transcript-report-pipeline.md
goal: >
  cursor IDE sqlite 二进制日志命中 409 时黄条回落文案是死胡同短句（透传后端 message），
  改为像样中文说明；并按 design Phase 4 落 docs/sillyspec 跨仓跟进记录，登记 sillyspec 仓上报待办与本仓侧就绪声明。
implementation:
  - fallbackNoteForError（frontend/src/components/daemon/agent-log-card.tsx:175）增 409 二进制专属分支，文案说明该日志为 cursor IDE sqlite 二进制库、不支持对话化回放、仅保留元数据可见；新文案不拼 FALLBACK_TAIL（原文端点同被 409 拒）
  - 409 命中按 err.code 为 HTTP_409_AGENT_LOG_BINARY_FORMAT 精确判定；其余 409（如 allowed_roots 拒读）与 422/404/5xx 维持既有透传文案逐字不变
  - 沿用既有黄条回落机制（setFallbackNote，frontend/src/components/daemon/agent-log-card.tsx:549），messages 侧不弹错框
  - 新建 docs/sillyspec/cursor-agent-transcript-report-pipeline.md，frontmatter 对齐 docs/sillyspec 既有文档（title/date/status/source 四字段）
  - 文档登记 sillyspec 仓待办——扫描 ~/.cursor/projects/*/agent-transcripts/*/*.jsonl、上报 format 串 cursor-agent-transcript-jsonl、归属沿用既有 ctx 规则；并声明本仓 daemon 解析器与平台 messages schema 先行就绪，上报落地前 cursor-agent 会话不出现在平台
acceptance:
  - 409 二进制场景黄条（agent-log-fallback-note 锚点）显示新中文说明，messages 侧无 role=alert 错框，原文端点红条现状语义不动
  - 422 / 504 / unsupported / parse_error / too_large 与非二进制 409 既有回落文案逐字不变（frontend/src/components/daemon/__tests__/agent-log-card.test.tsx 既有断言全绿）
  - 新文档存在，含 sillyspec 仓待办三要素（扫描路径 / format 串 / 归属规则）与本仓就绪声明
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/agent-log-card.test.tsx
constraints:
  - 不改 409 状态码与既有回落语义（静默黄条回落、不弹错框），只改文案与新增文档
  - 本仓不实现 cursor-agent transcript 扫描上报（属 sillyspec 仓，design 非目标）
  - allowed_paths 不含测试文件，本卡不改测试；新文案验证走既有测试回归 + 人工冒烟
---
