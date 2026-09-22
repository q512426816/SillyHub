---
id: task-08
title: '谱系溯源 UI——lineage-block 溯源块+谱系面包屑+浮层标题参数化+列表分叉分组徽标+page/dialog 双挂载+组件测试+claude 真机 E2E 验收记录（depends_on: task-06, task-07）'
title_zh: '谱系溯源 UI——lineage-block 溯源块+谱系面包屑+浮层标题参数化+列表分叉分组徽标+page/dialog 双挂载+组件测试+claude 真机 E2E 验收记录（depends_on: task-06, task-07）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-06', 'task-07']
blocks: []
requirement_ids: [FR-02, FR-05]
decision_ids: [D-002@v1]
expects_from:
  - task-07 fork 发起链路与组件目录 session-fork/
allowed_paths:
  - frontend/src/components/daemon/session-fork/lineage-block.tsx
  - frontend/src/components/daemon/session-panel/worker-session-overlay.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/daemon/__tests__/session-fork-lineage.test.tsx
  - backend/app/modules/daemon/router/session_insights.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - .sillyspec/changes/2026-09-22-session-fork-continuation/e2e-claude-fork.md
target_files:
  - NEW:frontend/src/components/daemon/session-fork/lineage-block.tsx
  - frontend/src/components/daemon/session-panel/worker-session-overlay.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - NEW:frontend/src/components/daemon/__tests__/session-fork-lineage.test.tsx
goal: >
  谱系溯源闭环：B 顶部常驻溯源块+多跳面包屑、点击浮层看原会话（WorkerSessionOverlay 泛化）、列表 origin+fork_of 分组徽标；收口 claude 真机 E2E 验收记录。
implementation:
  - （D-014③ 前置）backend/app/modules/daemon/router/session_insights.py：SessionRunRead DTO 增 engine_anchor 可空字段透出（轮级门控数据源）+ pnpm gen:types 刷新（PYTHONPATH=<WT>/backend 陷阱）
  - 新建 frontend/src/components/daemon/session-fork/lineage-block.tsx：溯源块（分叉自哪会话@第几轮+引擎档标注+时间，数据=SessionRead fork 字段，不依赖消息内容渲染）+谱系面包屑（A→B→当前，逐节点可点）；点击回调开浮层
  - worker-session-overlay.tsx 标题参数化（「分身会话」→title prop）+「已分叉」状态条；复用为原会话浮层
  - session-panel-page.tsx + session-panel-dialog.tsx 双模式挂载：溯源块（origin='fork' 会话顶部常驻）+ TurnForkEntry 接线（engineAnchor prop 取 /runs engine_anchor；轮容器加 group 类——task-07 hover 方案要求）+ ForkConfirmModal 挂载（onForked 跳转 B 会话）
  - session-list-panel.tsx 分叉子会话挂源会话附属分组（origin+fork_of 判定，与分身组 parent_session_id 判定并行不混树，:2403-2489 现状旁）+「🔗 分叉」徽标
  - 新建 __tests__/session-fork-lineage.test.tsx：溯源块渲染/多跳面包屑/浮层打开/列表分组与徽标/入口 prop 接线
  - claude 真机 E2E：对真实会话第 N 轮分叉→B 问第 1~N 轮内容可答+问第 N+1 轮内容不知情+fork 后 A 全字段不变；过程与结论记入 e2e-claude-fork.md
acceptance:
  - B 面板顶部溯源块常驻且点击浮层可看 A 完整记录；多跳链面包屑逐级可点
  - 列表 B 挂 A 分组下带分叉徽标，与分身组不混
  - E2E 记录落盘含「不知情」断言证据（B 对分叉点后内容）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-fork-lineage.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - .sillyspec/changes/2026-09-22-session-fork-continuation/e2e-claude-fork.md 存在且含不知情断言结论
constraints:
  - 样式对齐原型 prototype-session-fork.html（brand-* 语义阶+主题 token，双主题铁律）
  - 浮层泛化零复制流渲染逻辑（复用 SessionPanel 链路，同分身浮层约束）
  - 禁跑全量测试；E2E 手工步骤不自动化
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
