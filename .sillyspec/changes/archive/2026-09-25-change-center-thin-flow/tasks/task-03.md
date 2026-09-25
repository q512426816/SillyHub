---
id: task-03
title: 'Route quick-type new changes to thin initial stage'
title_zh: '写入分流：quick 类型新变更进 thin 阶段'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change_writer/service.py
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/change_writer/tests/test_classifier.py
target_files:
  - backend/app/modules/change_writer/service.py
  - backend/app/modules/change_writer/proxy.py
goal: >
  change_writer 双写入口（service/proxy）对 quick 类型新变更的 initial_stage 从 "quick" 改为 "thin"，change_type 分类标签保留不动。
implementation:
  - backend/app/modules/change_writer/service.py:129-132 分流映射改 initial_stage = "thin" if change_type == "quick" else "brainstorm"；:188-189 stages JSON 初值随 initial_stage 单变量联动（确认无独立 quick 硬编码残留）
  - backend/app/modules/change_writer/proxy.py:346-349 同款分流；:380-381 stages 初值同核
  - backend/app/modules/change_writer/tests 分流映射断言更新（test_classifier.py 快速分类/分流映射用例期望 quick→thin）
acceptance:
  - change_type=="quick" 的新变更 initial_stage=="thin"、stages JSON 含 thin 组不含 quick 组
  - change_type 标签仍写 "quick"（分类器与 TYPE_LABEL 不动）；feature/prototype 仍走 brainstorm
verify:
  - cd backend && uv run pytest app/modules/change_writer/tests -q --no-cov
constraints:
  - 分类器 _QUICK_PATTERNS 与 change_type 三值不动（标签与阶段解耦，D-001@v1）
  - 存量在途 quick 变更不受影响（只改新变更入口）
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
