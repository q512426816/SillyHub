---
id: task-07
title: 'frontend takeover bridge UI and gen types'
title_zh: '前端衔接状态全量 + gen:types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: [task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v1, D-005@v2, D-006@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/lib/takeover.ts
  - frontend/src/lib/agent-logs.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/__tests__/
  - frontend/openapi.json
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - NEW:frontend/src/lib/takeover.ts
  - frontend/src/lib/agent-logs.ts
  - frontend/src/lib/api-types.ts
  - NEW:frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
expects_from:
  task-04:
    - contract: TakeoverResponse
      needs: [session_id, run_id, tier, handoff_doc]
  task-05:
    - contract: handoff tier takeover behavior
      needs: [handoff_doc, provider_reselect, agent_profile_reselect]
  task-06:
    - contract: ResetToolReportResponse
      needs: [session_id, status, cleared_runs]
goal: >
  前端未激活 tool_report 会话输入区改造：衔接方式提示条（native/handoff）、接手 agent 选择器、takeover 发送切会话、原机离线态、存量重置按钮，同步 gen:types（FR-06，对照原型 prototype-tool-report-activation.html）。
implementation:
  - pnpm gen:types 同步 backend OpenAPI（Takeover/Reset DTO 与 agent-logs reported_machine 字段；先确认 node_modules 健康，CLAUDE.md 规则 21）
  - 新建 frontend/src/lib/takeover.ts 封装 takeoverSession/resetToolReport 调用；agent-logs.ts 条目类型补 reported_machine 字段
  - page-helpers.tsx 加 takeover chrome 派生（提示条档位判定=harness 可 resume 集合/上报机器在线 join/禁用态；对齐 derivePreSessionChrome 先例）
  - session-panel-page.tsx 未激活分支：输入区上方衔接提示条（native 绿/handoff 黄/handoff 含分叉说明文案）、handoff 档接手选择器（引擎下拉=原机 daemon provider 集合 + 档案下拉=agent-profiles）、发送改调 takeover 并按响应 session_id 切换会话面板、原机离线红色态输入禁用
  - 已激活（turn_count>0）tool_report 会话：头部 ⋯ 菜单 + 失败轮快捷入口加「重置为未激活」（确认弹窗，调 reset 后 invalidate 会话列表/详情）
  - 组件测试 session-panel-takeover.test.tsx：提示条档位、选择器数据、发送切会话、重置确认流、chat 会话零渲染
acceptance:
  - 未激活 claude-code 会话显示绿色「接续原会话+机器名」提示条；zcode 显示黄色「分叉+交接文档」提示条与选择器
  - 原机离线：输入禁用 + 错误卡（回放仍可浏览）；takeover 成功后自动切到新会话
  - 已激活 tool_report 会话可一键重置回只读回放态；origin=chat 会话不渲染任何新元素
  - pnpm gen:types 产物提交（api-types.ts + openapi.json）；组件测试全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- session-panel-takeover
constraints:
  - 样式沿用 AI-Native 主题 token（brand/ok/warn/err 语义阶，禁手写蓝色阶）
  - 与后端字段严格走 gen:types 生成类型（禁手写 DTO）
  - 仅 origin=tool_report 会话渲染新元素；不改动普通会话输入区行为
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
