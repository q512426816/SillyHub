---
id: task-02
title: 'change-file-tree autoRefreshMs prop'
title_zh: 'ChangeFileTree 可选自动刷新 prop'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:20:26
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/change-file-tree.tsx
  - frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx
  - frontend/src/components/__tests__/change-file-tree.test.tsx
related_tests:
  - frontend/src/components/__tests__/change-file-tree.test.tsx  # 既有组件测试，改 Props 后须保持全绿（回归守护）
target_files:
  - frontend/src/components/change-file-tree.tsx
  - NEW:frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx
provides:
  - contract: ChangeFileTree 可选自动刷新 prop
    fields:
      - 'autoRefreshMs 可选 number prop，默认 undefined 不轮询'
      - '设置时挂载起 setInterval 周期调 refreshTree 与 refreshPending，卸载清除'
goal: >
  补上 ChangeFileTree 文件树实时性（FR-05 / D-004@v1）：组件现状是挂载单次拉取 +
  手动刷新钮（唯一 setInterval 仅保存 pending 态），「实时掌控」需要可选自动刷新。
implementation:
  - frontend/src/components/change-file-tree.tsx:44 Props 接口加 `autoRefreshMs?: number`，解构默认不设值
  - 新增 useEffect：autoRefreshMs 存在且 >0 时 setInterval(() => { void refreshTree(); void refreshPending(); }, autoRefreshMs)，依赖 [autoRefreshMs, refreshTree, refreshPending]；cleanup clearInterval（对齐组件内既有 pollRef 清理模式 frontend/src/components/change-file-tree.tsx:433-436）
  - 不动既有保存 pending 轮询（frontend/src/components/change-file-tree.tsx:438 setInterval）——两定时器职责正交
  - 同卡写测试 NEW frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx（vitest fake timers + testing-library，mock lib/change-files 的 listChangeFiles/listPendingChangeFiles）：①不传 autoRefreshMs 时 advanceTimersByTime(30000) 后请求次数不增（回归守护）；②传 autoRefreshMs={15000} 时每 15s 触发刷新（advance 后断言调用次数）；③卸载后计时器清除（unmount + advance 后无新请求）
acceptance:
  - autoRefreshMs 不传时组件行为与现状一致（无新增定时器/请求）——回归测试断言
  - 传 15000 时每 15s 调用 refreshTree/refreshPending（fake timers 断言），卸载清除
  - 新测试文件全绿 + 既有 change-file-tree 相关测试（如有）不红
verify:
  - cd frontend && pnpm vitest run src/components/__tests__/change-file-tree-autorefresh.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只加一个可选 prop，禁止重构组件（D-004@v1：默认行为逐字节不变）
  - 不动保存 pending 轮询逻辑
  - 既有消费方（frontend/src/components/changes/detail/change-files-card.tsx / mobile-change-detail）零改动
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
