---
id: task-04
title: 'add-input-ref-overlay-kind-badges'
title_zh: 'InputRefOverlay 类型角标与 tooltip 元数据'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/components/daemon/input-ref-overlay.tsx
  - frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
provides:
  - contract: InputRefOverlayTokenMetas
    fields: [kind, title]
goal: InputRefOverlay 扩展 tokenMetas props，为镜像层标签渲染左上角 lucide 类型角标与悬停 tooltip 元数据（D-001），不破坏 overlay 与 textarea 逐字符对齐。
implementation:
  - props 增可选 tokenMetas（frontend/src/components/daemon/input-ref-overlay.tsx:29-45）——token 到元数据映射，kind 取 att/file/dir/code 分别映射 Paperclip/FileText/Folder/Braces（lucide）
  - token span 左上角渲染类型角标——absolute 定位不进文本流（与右上 × 角标同视觉语言），不改变标签文本宽度；tokenMetas 未命中的 token 不渲染角标
  - 悬停 tooltip——沿用 visibleBadgeIndex 与 hitTestAttRefOverlay 淡入机制，命中处显示 title 完整绑定元数据（frontend/src/components/daemon/input-ref-overlay.tsx:141-175 角标渲染区）
  - 扩展 frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx——四类 kind 角标图标正确、tooltip 元数据、版式守卫用例（加角标后标签占位文本与背景块宽度不变、token span 无 opacity/transform）
acceptance:
  - 四类角标图标按 kind 正确渲染；未传 tokenMetas 或 token 未命中时渲染与现状逐字一致（零视觉回归）
  - 版式守卫用例绿——背景块无 margin/padding、角标 absolute 不进文本流、× 角标 z-20 层级不受影响（R-01）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/input-ref-overlay.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 镜像层铁律——背景块严禁 margin/padding/border 只用 background 加 radius（错位教训 2026-10-10 mx-px 累积漂移），角标 absolute 定位不进文本流
  - token span 不得带 opacity/transform 等 stacking context 触发器，× 角标 z-20 不失效
  - 角标取色 brand-* 语义阶随主题换肤，文案中文；后端 0 端点；未传 tokenMetas 时组件行为与现状逐字一致
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
