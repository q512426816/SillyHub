---
id: task-03
title: '目录数据派生——session-panel-page.tsx 复用 runsMeta 合并 displayTurns 生成 catalogEntries'
title_zh: '目录数据派生——session-panel-page.tsx 复用 runsMeta 合并 displayTurns 生成 catalogEntries'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - 'frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx'
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
expects_from:
  - 'task-02 的 TurnCatalogEntry 类型（frontend/src/components/sessions/turn-catalog.tsx 导出：key/turnNo/startedAt/status/senderName/promptSummary/answerSummary/loaded 八字段）与 TurnCatalog 组件 props 形态（entries/activeTurnKey/loadingEarlier/onJump）'
provides:
  - 'catalogEntries 数组（TurnCatalogEntry[]）：按 runsMeta started_at 时间正序 1 基定号；displayTurns 命中（realRunId ?? runId）覆盖 prompt/answer 摘要并置 loaded=true；runs 未覆盖的孤儿轮尾部追加（key = realRunId ?? runId）；runsMeta 为空时降级为仅已加载轮次条目'
related_tests:
  - 'frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx'
goal: >
  在 session-panel-page.tsx 复用既有 runsMeta state 合并 displayTurns，useMemo 派生
  catalogEntries（TurnCatalogEntry[]）——runs 全量轮次定序定号补全未加载轮次（空心刻度
  数据源），已加载轮次用本地摘要覆盖，实现全量历史轮次覆盖（FR-03）且零后端新增调用（D-004）。
implementation:
  - '复用既有 runsMeta（Map<string, SessionRunRead>，attach 期与每轮 turn_completed 后已全量拉刷，session-panel-page.tsx:261），不新增 useQuery / queryKey（R-08）。'
  - 'useMemo 派生 orderedRuns：runsMeta.values() 按 started_at 时间正序排序（缺失键回退 finished_at / 空串，稳定排序）。'
  - 'useMemo 派生 catalogEntries：loadedByKey = displayTurns 按 realRunId ?? runId 建 Map；orderedRuns.map 生成条目——key=run.id、turnNo=i+1、startedAt=run.started_at、status=mapRunStatus(run.status)、senderName=run.sender_name、loaded=!!loaded；命中项 promptSummary=prompt 截 60 字、answerSummary=firstTextSegment(turn) 截 120 字。'
  - '实现局部工具 firstTextSegment（turn.segments?.find(kind==="text")?.text ?? turn.output，旧回退路径无 segments 用 output）与 mapRunStatus（run.status 字符串映射 completed/failed/running/stopped/pending 五档）。'
  - '孤儿兜底（R-03）：displayTurns 未命中 runsMeta 的尾部轮追加条目（key = realRunId ?? runId、turnNo 保守取 max+1、loaded=true）。'
  - '降级：runsMeta 为空（异常路径）时 catalogEntries 仅由 displayTurns 生成（全部 loaded=true），不崩不空。'
  - '本任务只产出 catalogEntries 数据派生与类型接线；TurnCatalog 挂载 / 布局包裹 / 跳转链路分别属 task-04~06。'
acceptance:
  - 'catalogEntries 类型为 TurnCatalogEntry[]，runsMeta 有值时条目覆盖全部历史轮次（含未加载轮 loaded=false、两摘要缺省）。'
  - '轮号按 runsMeta started_at 时间正序 1 基编号；已加载轮摘要来自 displayTurns（prompt 截 60 字、首个 text 段或 output 截 120 字）。'
  - '条目 key 与 data-turn-key 同源（run.id / realRunId ?? runId）；displayTurns 孤儿轮尾部追加不丢失。'
  - 'runsMeta 为空时降级为仅已加载轮次条目，页面不崩；src/app/(dashboard)/sessions 既有用例不回归。'
  - 'cd frontend && pnpm exec tsc --noEmit 0 错误。'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run "src/app/(dashboard)/sessions"
constraints:
  - '不新增任何后端调用 / useQuery，不手写 api-types.ts（复用既有 runsMeta，D-004 / R-08）。'
  - '不在本任务挂载 TurnCatalog、不做布局包裹与跳转链路（task-04~06 承接），仅数据派生。'
  - '不改 dialog 宿主渲染分支、sessions-portal、session-list-panel。'
  - 'turnNo 以 runs 全序为基准，聊天区不加轮号显示（design §6）；tool_report 会话 platform-managed 轮行为不受影响。'
  - '派生 useMemo 依赖最小化（runsMeta / displayTurns），避免无关重算。'
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
