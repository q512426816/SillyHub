---
id: task-07
title: 'frontend 翻页测试——before_id 透传 / 同 ts 不同 id 判定有进度（跳转循环不误 break）/ 换会话游标重置 / 初始加载后首翻带 beforeId；**连带回归**：session-history-scroll.test.tsx 三场景（触顶 loadEarlier+prepend/连续 3 页 cursor 递减/overflowAnchor）与既有 getAgentSessionLogs mock 参数断言套件随改校准'
title_zh: 'frontend 翻页测试——before_id 透传 / 同 ts 不同 id 判定有进度（跳转循环不误 break）/ 换会话游标重置 / 初始加载后首翻带 beforeId；**连带回归**：session-history-scroll.test.tsx 三场景（触顶 loadEarlier+prepend/连续 3 页 cursor 递减/overflowAnchor）与既有 getAgentSessionLogs mock 参数断言套件随改校准'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
depends_on: [task-06]
related_tests:
  - frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（既有三场景：触顶 loadEarlier+prepend/连续 3 页 cursor 递减/overflowAnchor——mock 若精确断言请求参数需补 before_id）
goal: >
  前端翻页行为测试：before_id 透传、同 ts 不同 id 判定有进度、换会话游标重置、初始加载后
  首翻带 beforeId；既有翻页套件随改校准。
implementation:
  - 在 session-history-scroll.test.tsx（既有翻页测试宿主）新增：①首翻请求断言 query 带 before_id ②同 ts 两页（id 递减）loadEarlierOnce 返回 true（跳转循环不误 break）③换会话后首翻游标取新会话 logs[0]
  - 既有三场景 mock/断言校准（连续 3 页 cursor 递减场景改用 (ts,id) 递减或补 before_id 断言）
  - page.test.tsx（frontend/src/app/(dashboard)/sessions/__tests__/）若有 getAgentSessionLogs mock 参数精确断言，补 before_id 可选参数
acceptance:
  - 新增三用例 + 既有三场景全绿
  - 无 mock 因缺 before_id 参数而误挂
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-history-scroll.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
constraints:
  - 不为躲断言改回旧行为（缺 before_id 时不发参数是设计语义，mock 断言按此校准）
  - 测试数据复用既有 4627 行体量手法，不引新夹具库
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
