---
id: task-04
title: 'Sync auth-flow doc semantics and TTL numbers'
title_zh: 'auth-flow 文档同步（族语义 + 宽限窗 + TTL 纠错）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 15:53:07
priority: P1
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/flows/auth-flow.md
target_files:
  - .sillyspec/docs/multi-agent-platform/flows/auth-flow.md
goal: >
  auth-flow.md 同步新语义：族级吊销 + grace 300s + TTL 数字纠错（15min/7d 改实际 30min/14d，R-05）。
implementation:
  - 更新流程摘要：access 30min / refresh 14d / grace 300s（对齐 config.py 实际默认）
  - 失败回滚表「refresh token 重放/失配」行改族级吊销语义（仅吊销该设备族系，其他设备不受影响）
  - 补前端行为：refresh 请求 5xx/408/429 不清会话（瞬态），401 才清会话跳登录
  - 关键术语区 TTL 数字纠错
acceptance:
  - 文档所述 TTL/宽限值与 backend/app/core/config.py:153-168 实际默认一致
  - 族语义描述与 backend/app/modules/auth/service.py:408-431 实现一致
verify:
  - 人工对照 config.py 与 service.py 逐项核（文档类 diff 自查）
constraints:
  - 仅文档改动，不动任何代码；中文表述（专业术语除外）
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
