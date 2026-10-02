---
id: task-13
title: 'FRONTEND_PAGE_STYLE.md 回写（primer 章节 + D-304 条款改写）'
title_zh: 'FRONTEND_PAGE_STYLE.md 回写（primer 章节 + D-304 条款改写）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-12']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-002@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
target_files:
  - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
goal: >
  FRONTEND_PAGE_STYLE.md 回写 primer 组件规范章节 + 改写 D-304 双体系豁免条款
  （PPM 范围不变，R-07），让规范与本变更落地后的现实一致。
implementation:
  - 新增「§primer 组件库」章节：十原语清单+props 契约要点+消费规范（页面结构组件优先 primer，antd 仅控件类）+ StateLabel 变体语义表（open/merged/attention(zap|clock)/done/error/neutral ↔ 业务状态映射）
  - 改写 D-304 适用条款：PPM 类页面全量条款适用范围不变（PPM 已上线）；工作台式页面按钮统一 primer preset、§4 DataTable 豁免收窄为「antd Table 仅存 PPM 类页面」
  - 更新基准页说明（工作台类页面以变更中心页为新基准参照）
acceptance:
  - 文档含 primer 章节与 StateLabel 语义表；D-304 条款改写后 PPM 范围表述不变
  - 与落地实现一致（组件名/props 对照 frontend/src/components/primer/index.ts 导出）
verify:
  - grep -c "primer" .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md（应 ≥5）
constraints:
  - 仅改 FRONTEND_PAGE_STYLE.md（不动其他 scan 文档，模块文档归 archive 阶段处理）
  - PPM 条款文字保持原语义（R-07：改写含糊=失去 PPM 维护依据）
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
