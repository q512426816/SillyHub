---
id: task-10
title: '前端测试 + tsc + eslint'
title_zh: '前端测试 + tsc + eslint'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - frontend/src/components/llm-providers/__tests__/
  - frontend/src/components/sessions/__tests__/
  - frontend/src/components/daemon/__tests__/
  - frontend/src/lib/api/__tests__/
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/
  - frontend/src/app/m/workspaces/[id]/sessions/__tests__/
target_files:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx
  - frontend/src/lib/api/__tests__/llm-providers.test.ts
goal: >
  前端测试收口（Wave5-12）：表单列表编辑器交互用例（增删行/角色标签/三态切换/fetch 一键
  加入）、门控链与配置条下拉源用例、存量旧字段断言修复；tsc 与 eslint 全绿门。
implementation:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx 与 llm-provider-form-fetch-config.test.tsx 重写模型区用例：添加/删除行、行内改模型名与三态下拉、角色标签多选与提示、one_m 勾选、fetch 一键加入新行、空白行不提交、存量 models 回显、旧 4 槽断言删除
  - frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx：列表卡片展示改 models（主模型 + 角色标签）断言
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx：模型下拉候选源 = provider.models 条目名列表断言（选中生效链）
  - 门控链用例（Wave5-12）：ctx-usage-bar / page-helpers 相关测试文件内补条目 one_m 与主模型派生断言（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx 既有文件扩展；session-panel 域在 frontend/src/components/daemon/__tests__/ 相邻文件）
  - frontend/src/lib/api/__tests__/llm-providers.test.ts：payload models 形态断言（Create/Update 传条目列表）
  - 移动端 frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx 与 sessions/__tests__/page.m-sessions.test.tsx 旧字段 mock/断言改 models 口径
  - 修复 task-08/09 切换后 tsc 报的测试文件红（mock 数据补 models 字段、旧断言删除）；非测试逻辑有误禁止反向改实现（规则 9）
  - 全绿门：tsc --noEmit、eslint、vitest 相关套件
acceptance:
  - 表单编辑器交互用例齐全（增删行/三态/角色标签/one_m/fetch 一键加入/回显/空白行拒绝）
  - 配置条下拉源、门控展示、api payload、移动端 mock 全部切 models 口径，无旧字段断言残留（grep __tests__ 目录四旧字段仅允许出现在「已删除断言」的历史注释外零命中）
  - cd frontend && pnpm exec tsc --noEmit 全绿；eslint 全绿；相关 vitest 套件全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src --ext .tsx,.ts
  - cd frontend && pnpm exec vitest run src/components/llm-providers src/components/sessions src/components/daemon src/lib/api src/app/m
constraints:
  - MUST NOT 跑全量测试（规则 0）；仅跑上述相关套件，全量留给 CI
  - MUST NOT 为绿弱化断言或 skip 用例；MUST NOT 改实现代码迁就旧测试（规则 9，实现缺陷回写对应 task 卡）
  - 仅动 allowed_paths 六个测试目录；组件实现返工回写 task-08/09 卡并修复后重跑
  - vitest 断言形态沿用各文件既有 RTL 惯例（AntApp/form 依赖处理照旧），不引入新测试依赖
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
