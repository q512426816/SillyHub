---
id: task-03
title: '前端对比弹窗：失败卡按 daemon_code 四臂分支 + full-tree 来源提示'
title_zh: '前端对比弹窗：失败卡按 daemon_code 四臂分支 + full-tree 来源提示'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-004@v1, D-006@v2, D-012@v1]
expects_from:
  task-02:
    - contract: "SillySpecConflictCompareResponse"
      needs: [record_label, covered_changes, path_total]
allowed_paths:
  - frontend/src/components/changes/conflict-compare-modal.tsx
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
target_files:
  - frontend/src/components/changes/conflict-compare-modal.tsx
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
related_tests:
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
goal: >
  让对比失败卡按真实错误码分支（不再把「记录缺失」误报成「机器离线/504」），
  并在 full-tree 兜底命中时标注记录来源与本次展示范围。
implementation:
  - frontend/src/components/changes/conflict-compare-modal.tsx:260-277 失败卡改为按 ApiError.details.daemon_code 与 ApiError.code 四臂分支：conflict_record_missing → 「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」（服务端 message 小字附注）+ 不渲染「重试」；workspace_root_unknown → 「该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。」+ 不渲染「重试」；code ∈ {HTTP_504_DAEMON_RUNTIME_OFFLINE, HTTP_504_DAEMON_RPC_TIMEOUT} → 保留「机器离线或响应超时（504），请确认数据源机器在线后重试。」+「重试」；其余 → 「读取机器侧冲突快照失败，请稍后重试。」+「重试」
  - 分支判定抽成纯函数（failureCardBranch(err)）便于测试；details 解析容错（可能为 null/非对象）
  - 兜底命中：响应 record_label==="full-tree" 时在弹窗主体顶部插一行来源提示（对齐 :287-291 response_truncated 提示位），文案「该记录由全量同步产生（覆盖 N 个变更），本次仅展示与 <change> 相关的 M 个路径」；固定说明行、无关闭控件
  - 测试：更新既有失败卡断言为四臂；新增各臂文案/按钮断言与来源提示断言
acceptance:
  - 单测：daemon_code=conflict_record_missing → 文案含「已无快照」「重新同步」，且无「重试」按钮、无「504」「离线」字样
  - 单测：daemon_code=workspace_root_unknown → 认领文案、无「重试」；code=HTTP_504_DAEMON_RUNTIME_OFFLINE → 504 文案 + 「重试」；未知 502 → 通用失败文案 + 「重试」
  - 单测：compare 响应 record_label=full-tree 且 covered_changes 2 项 → 顶部提示含「覆盖 2 个变更」+ 变更名 + 路径数；无该字段（旧后端）→ 不渲染提示条
  - 既有 conflict-compare-modal.test.tsx 全部用例更新后全绿
verify:
  - cd frontend && pnpm test -- src/components/changes/__tests__/conflict-compare-modal.test.tsx
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - 分支键必须为 details.daemon_code（外层 code 恒为 HTTP_502_DAEMON_RPC_REMOTE，禁止用它区分 conflict_record_missing）（D-012@v1）
  - 主题 token 铁律零硬编码色；不改裁决（保本地/取平台）链路与弹窗其余交互（D-002）
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
