---
id: task-01
title: '消费链精确定位（R-03/R-04）：daemon 上报封装函数 + 前端条目渲染组件逐环定位，回写 design 文件清单'
title_zh: '消费链精确定位（R-03/R-04）：daemon 上报封装函数 + 前端条目渲染组件逐环定位，回写 design 文件清单'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-27 13:02:37
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/agent-log/tool-renderers.tsx
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/lib/daemon/session-sse.ts
  - sillyhub-daemon/src/hub-client.ts
  - .sillyspec/changes/2026-10-28-bg-task-status-report/design.md
target_files:
  - .sillyspec/changes/2026-10-28-bg-task-status-report/design.md
goal: >
  R-03/R-04 残余定位收口：前端「后台任务·运行中」条目精确渲染组件（SSE→组件消费链逐环 grep 定位）+ HubClient 封装层细节（notifyTurnPhase 同款方法全貌），产出回写 design 文件清单（只读调研卡，产出=design 清单补录）。
implementation:
  - grep SSE bg/后台任务消费链：session-sse.ts 事件信封→活动条目组件（候选 agent-log 渲染群 normalize/tool-renderers）逐环锚定截图条目的真实渲染文件
  - 读 hub-client.ts notifyTurnPhase 方法全貌（camel→snake 映射/错误处理/HTTP 封装形态）
  - 回写 design.md 文件变更清单精确路径（替换候选措辞）
acceptance:
  - design 清单含前端条目组件精确路径（存在性 test -f 实证）
  - hub-client 方法形态记录入 task-03 卡 implementation 参考
verify:
  - test -f <定位到的组件路径>
constraints:
  - 只读调研不改代码（定位产出归 design 回写）
  - 不越本卡 allowed_paths 改动
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
