---
id: task-07
title: 'frontend conflict-compare-modal.tsx + lib/daemon.ts 实现'
title_zh: 'frontend conflict-compare-modal.tsx + lib/daemon.ts 实现'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-09]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/components/changes/conflict-compare-modal.tsx
target_files:
  - frontend/src/lib/daemon.ts
  - NEW:frontend/src/components/changes/conflict-compare-modal.tsx
goal: >
  实现冲突对比弹窗与 compare 取数函数——前端纯渲染后端算好的本地/平台差异，用户核对差异后在弹窗内裁决（D-002@v1 裁决入口收进弹窗），解决只能凭变更名盲裁的风险。
implementation:
  - lib/daemon.ts 新增 getSillySpecConflictCompare(instanceId, change, kind, workspaceId)——GET compare 端点（kind 与 workspace_id 走 query，apiFetch 先例见 triggerMachineSillySpecResolve :270 区），返回 api-types 生成版 SillySpecConflictCompareResponse
  - 新建 conflict-compare-modal.tsx（antd Modal 对齐 file-preview-modal.tsx 先例，视觉对照 prototype-conflict-diff-compare.html）——打开即 react-query 拉 compare 端点（enabled=open），loading 与失败重试态齐备
  - 顶部时间条——本地/平台最后更新时间，较旧一侧橙色方向提示（取平台将回退/保本地将回退平台较新内容），文案明示本地时间取自文件 mtime 仅辅助参考
  - spec-tree 模式——左栏文件清单（徽章 修改/仅本地/仅平台/相同，默认只看差异可切全部，头部「涉及 N 个文件，其中归档 M 个」）+ 右栏 side-by-side diff（删行红 bg-error/10、增行绿 bg-success/10）；binary/local_truncated/diff_truncated 显示占位提示条
  - progress 模式——关键信息对比表（对比项/本地/平台三列），differ 行橙色高亮，不展示原始 JSON（D-003@v1）
  - 底部裁决条——后果说明文案 + 保本地（primary）/取平台（danger），复用 triggerMachineSillySpecResolve + STRATEGY_TEXT modal.confirm 二次确认，下发成功关闭弹窗，回显走既有 sillyspec_command_result 链路
acceptance:
  - 打开弹窗即 loading，504/失败态可重试，成功后按 kind 渲染对应模式
  - spec 树模式清单徽章与「只看差异/全部」切换、头部 N/M 计数正确；diff 删红增绿全用语义 token；二进制与截断文件有占位提示
  - 进度模式 differ 行橙色高亮且无原始 JSON；时间条较旧一侧有橙色方向提示与 mtime 辅助说明
  - 裁决按钮经 STRATEGY_TEXT 二次确认后下发成功并关闭弹窗
  - task-06 的 conflict-compare-modal.test.tsx 全绿且 tsc 0 错
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/conflict-compare-modal.test.tsx && pnpm exec tsc --noEmit
constraints:
  - 语义 token（text-error/bg-muted/bg-success/10/brand-*）禁 hex 硬编码，antd 组件色经 ConfigProvider
  - 不引入前端 diff 库——diff_rows 由后端算好前端纯渲染；仅消费 api-types 生成版类型，禁手写契约
  - 行上「查看对比」入口与弹窗挂载归 task-08，本卡不改 platform-sync-section.tsx；裁决通道与回显语义零改动
expects_from:
  - 'task-05 ApiTypes（needs=[SillySpecConflictCompareResponse, DaemonHeartbeatSillySpecConflict.ql_id]）'
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
