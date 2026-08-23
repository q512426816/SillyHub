---
id: task-06
title: '三仓回归（pytest/vitest/daemon test+typecheck）+ 真实 zcode 会话端到端实证（对话渲染/回落/无 system 泄漏）+ runtime-evidence 留档'
title_zh: '三仓回归（pytest/vitest/daemon test+typecheck）+ 真实 zcode 会话端到端实证（对话渲染/回落/无 system 泄漏）+ runtime-evidence 留档'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - /Users/qinyi/.sillyhub/daemon/specs/de24ed7c-a888-4d0c-83cf-dfebfd2021d6/changes/2026-08-23-agent-log-conversation-view/runtime-evidence.md
  - /Users/qinyi/SillyHub/.sillyspec/changes/2026-08-23-agent-log-conversation-view/runtime-evidence.md
goal: >
  Wave 5 收尾：三仓全量回归（backend pytest / frontend vitest / daemon test+typecheck）+
  部署环境真实 zcode 会话端到端实证（对话渲染/全场景回落/409 不变/无 system 泄漏）+
  runtime-evidence.md 双路径留档，对照 plan 全局验收标准逐条销项。
implementation:
  - 三仓全量回归：backend pytest（含新增 test_agent_log_messages.py 与既有 test_agent_log_content.py 零回归）；frontend vitest（agent-log-card 改写用例通过）；daemon pnpm test + pnpm typecheck
  - gen:types 一致性：frontend pnpm gen:types:check 通过（api-types.ts 与 backend/openapi.json 与后端 schema 零 diff，plan 全局验收 4）
  - 端到端实证（部署环境真实数据，对照 plan 全局验收 2 与 design §10）：真实 zcode 会话条目「查看内容」→ 对话流渲染（用户气泡/Markdown 正文/工具卡片可展开输入与结果/思考折叠/超 200 段时加载更早）
  - 回落实证：codex（无解析器）条目 → 静默回落原文 <pre>；老 daemon 模拟（method-not-found）→ 422 后回落；文件被轮换 → 404 既有文案
  - 拦截实证：dsh zstd / cursor sqlite 条目 → 409「二进制暂不支持」文案不变（FR-04）
  - 隐私实证（R-04）：渲染面板 DOM 抽查无系统提示词 / request.body.system / <system-reminder> 内容泄漏
  - brownfield 实证（plan 全局验收 3）：不点新按钮时既有行为零变化，旧 content 端点保留可用
  - runtime-evidence.md 留档：命令输出摘要 + E2E 实证清单逐条结论（含截图/引文），平台镜像路径与本地镜像路径两份同内容
acceptance:
  - 三仓命令全绿：backend uv run pytest -q --no-cov -n auto / frontend pnpm vitest run / daemon pnpm test && pnpm typecheck
  - frontend pnpm gen:types:check 零 diff 通过
  - E2E 实证清单逐条通过（对话渲染 / 三类回落 / 409 不变 / 无泄漏 / 旧端点可用）
  - runtime-evidence.md 在两个 allowed_path 均已留档且内容一致
verify:
  - cd backend && uv run pytest -q --no-cov -n auto
  - cd frontend && pnpm vitest run
  - cd sillyhub-daemon && pnpm test && pnpm typecheck
  - cd frontend && pnpm gen:types:check
  - E2E 实证清单对照 design §10（R-01~R-07 应对生效）与 plan 全局验收标准 1-4（对话渲染/回落/409/无泄漏）
constraints:
  - 不改源码：只跑回归 + 部署环境实证 + 写 runtime-evidence.md；发现缺陷登记并回对应 task 卡，不在本卡顺手修
  - 实证用部署环境真实 zcode 日志条目（非合成 fixture），CLI 侧产生新会话日志驱动全链路
  - runtime-evidence.md 双路径留档（平台镜像 /Users/qinyi/.sillyhub/... 与本地 .sillyspec 镜像），内容保持一致
  - 三仓命令在各自仓库根目录执行；sillyspec CLI 一律在主仓库根目录跑（CLAUDE.md 22）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
