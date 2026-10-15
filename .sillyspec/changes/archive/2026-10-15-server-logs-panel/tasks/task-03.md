---
id: task-03
title: 'Build server log panel component and data layer'
title_zh: '前端数据层与日志组件——health.ts 数据层 + ServerLogPanel（行数切换/级别着色/展开原始行/下载/安全提示）+ 组件测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:20:11
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/lib/health.ts
  - frontend/src/components/server-log-panel.tsx
  - frontend/src/components/__tests__/server-log-panel.test.tsx
target_files:
  - frontend/src/lib/health.ts
  - NEW:frontend/src/components/server-log-panel.tsx
  - NEW:frontend/src/components/__tests__/server-log-panel.test.tsx
provides:
  - contract: ServerLogPanel
    fields: [组件默认导出, 可选 props lines 初始值]
expects_from:
  task-02:
    - contract: ServerLogsResponse
      needs: [entries, total_lines, returned, file, available_files, hint]
goal: >
  日志卡组件与数据层：health.ts 增 getServerLogs/downloadLogFile；新建 ServerLogPanel
  （卡内独立 5s 轮询、行数切换、级别着色、展开原始行、文件选择下载、安全提示）。
implementation:
  - frontend/src/lib/health.ts 增 getServerLogs(lines)：类型引用 api-types 生成物（ServerLogsResponse 系 task-02 gen:types 产出再导出，规则 21 禁手写）；downloadLogFile(name) 返回 Blob——fetch 带 Bearer 经 getApiBaseUrl，401 单飞刷新重试同型复用 frontend/src/lib/explorer.ts:64-94 先例（apiFetch 不可复用：需拿 Blob 非 JSON）
  - NEW frontend/src/components/server-log-panel.tsx："use client"；卡内 useEffect setInterval 5000 拉 getServerLogs（与页面轮询并行独立，端点不同）；行数分段控件 {100,200,500,1000}（默认 200，切换即拉取）；日志流行渲染：time/level（info 青/warn 琥珀/error 红/debug 灰语义 token）/{event+detail}，点击行 toggle 展开原始 JSON（pre）；工具条文件下拉（数据源响应 available_files）+ 下载按钮（downloadLogFile→createObjectURL→a[download] 点击→revoke）；安全提示「日志含运行路径与账号信息，请勿外传」；页脚「显示最近 N 行（文件共 M 行）·每 5 秒自动刷新」；失败→卡内独立错误条（不清既有数据）；加载中占位
  - NEW frontend/src/components/__tests__/server-log-panel.test.tsx（mock @/lib/health）：结构化行渲染（INFO/WARN/ERROR 与 time/event）；非 JSON 行 raw 降级展示；行数切换触发新请求（lines=500）；点行展开 raw；下载调用 downloadLogFile 且触发 URL.createObjectURL；内联 5s 轮询 fake timers 二次拉取；失败态错误条且数据不清空
acceptance:
  - vitest run server-log-panel 全绿（渲染/降级/切换/展开/下载/轮询/失败 7 组断言）
  - 组件测试覆盖 TaskCard acceptance 全部条目
  - 行级类名走 brand-*/语义 token，无硬编码 hex
verify:
  - cd frontend && pnpm exec vitest run src/components/__tests__/server-log-panel.test.tsx --no-coverage
constraints:
  - 不改 page.tsx（集成归 task-04）；不新增依赖（antd 组件 + tailwind 既有）
  - downloadLogFile 走 fetch+Blob（apiFetch 只处理 JSON）
  - 轮询失败静默降级留上一帧数据（错误条提示不打断页面）
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
