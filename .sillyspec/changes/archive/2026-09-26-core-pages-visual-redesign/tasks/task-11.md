---
id: task-11
title: '会话门户右栏信息面板 + 测试同步'
title_zh: '会话门户右栏信息面板 + 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/
target_files: []  # D-004@v1 降级：右栏样式统一并入 task-10 提交，本 task 无独立文件交付
expects_from:
  task-04:
    needs: [MetaPanel, MetaPanelSection]
goal: >
  会话门户右栏信息面板 Primer 化：会话信息 MetaPanel（引擎/状态/轮数/消耗/关联
  变更/参与智能体）+ 文件预览第三栏样式统一；红线=只动 render 与样式类。
implementation:
  - frontend/src/components/sessions/sessions-portal.tsx：第三栏（320-860px 文件预览）容器样式统一（把手/头部工具条 Primer 化）；新增/改造会话信息面板为 MetaPanel 分组（引擎+StateLabel 状态/已进行轮数/累计消耗 mono/关联变更 key mono 可点/参与智能体列表）
  - frontend/src/components/sessions/portal-file-panels.tsx（131 行）：文件列表条目与预览头部样式对齐 primer 视觉
  - 右栏可折叠/拖宽逻辑零改动（仅视觉）
  - 同步修相关既有测试断言
acceptance:
  - 右栏对照原型「会话」视图信息面板一致；拖宽/收起行为不变
  - 状态机/props/数据流 diff 为零
  - 既有测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/sessions "src/app/(dashboard)/sessions"
  - cd frontend && pnpm typecheck
constraints:
  - 红线：MUST NOT 改动文件预览数据流与折叠状态逻辑。
  - 信息面板数据源仅消费已有 props/queries（不新增请求）
  - 移动端零波及
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
