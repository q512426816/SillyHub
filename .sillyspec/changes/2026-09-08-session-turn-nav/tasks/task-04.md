---
id: task-04
title: '跳转链路——handleJumpToTurn（直跳/循环加载/suppress/hasEarlier 镜像/两档 toast）+ 触顶 hook 接 suppress'
title_zh: '跳转链路——handleJumpToTurn（直跳/循环加载/suppress/hasEarlier 镜像/两档 toast）+ 触顶 hook 接 suppress'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
provides:
  - handleJumpToTurn(entry) 回调——已加载轮：双 rAF + scrollIntoView block:start + 高亮 ~2.2s；未加载轮：循环 loadEarlier ≤8 页到命中或 hasEarlier=false；期间 suppress 触顶自动加载；兜底两档 toast（可续点）
  - activeTurnKey state——滚动联动当前轮 key（聊天滚动时随视口顶部最近轮更新，供 TickRail active 刻度联动）
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
goal: >
  为会话面板装配目录点击跳转链路 handleJumpToTurn（已加载直跳定位高亮、未加载循环翻页加载后定位、跳转期抑制触顶自动加载、两档 toast 兜底），并提供 activeTurnKey 滚动联动状态，支撑 TickRail 点击导航（AC-04）。
implementation:
  - 新增 hasEarlierRef 镜像既有 hasEarlier state（随 state 同步赋值），供跳转循环同步读取，规避 useCallback 闭包过期值。
  - 新增 jumpSuppressLoadEarlierRef（useRef(false)）；触顶自动加载 scroll 监听（session-panel-page.tsx 现行 995-1021 捕获阶段接线）在调 handleLoadEarlierRef 前检查该 ref，true 即跳过；若接线或常量需挪动则同步 page-helpers.tsx（LOAD_EARLIER_TRIGGER_PX 所在纯派生模块）。
  - 实现 handleJumpToTurn(entry)（useCallback，对齐 handleJumpToSubagent 先例 1990-2038）：container 取 bodyWrapRef 内 [data-testid="turn-timeline-scroll"]，hit() 用 querySelector('[data-turn-key="…"]') + CSS.escape 精确匹配（FR-07，禁类名匹配）。
  - 未命中分支：置 suppress=true 后 for（≤8 页 && !hit() && hasEarlierRef.current）await handleLoadEarlierRef.current()（既有回调 Promise 化复用，historyLoading 锁防并发）；finally 恢复 suppress=false。
  - '定位：双 rAF 等 DOM 提交后 hit()?.scrollIntoView({ behavior: "smooth", block: "start" }) + setHighlightTurnKey(entry.key)（消费 task-01 受控高亮，~2.2s 自清）。'
  - 兜底两档 toast：循环后仍无 hit 且 hasEarlierRef=false →「该轮次日志不存在（可能已被清理）」；达 8 页上限（hasEarlierRef 仍 true）→「已连续加载 8 页仍未到达，可再次点击继续加载」。
  - 新增 activeTurnKey state：聊天滚动时按视口顶部最近轮的 data-turn-key 派生更新（滚动联动当前轮 key，供 task-05 TickRail active 联动消费）。
acceptance:
  - 点击已加载轮条目：目标轮平滑滚动进视口且受控高亮生效（测试内 mock scrollIntoView 断言被调、block=start）。
  - 点击未加载轮条目：连续调用加载更早直至 data-turn-key 命中（≤8 页），随后定位 + 高亮 + 摘要回填。
  - suppress 生效期触顶（scrollTop ≤ LOAD_EARLIER_TRIGGER_PX）不触发自动加载；循环结束（含异常路径）后恢复触发。
  - hasEarlier=false 时循环提前停止并 toast「该轮次日志不存在（可能已被清理）」；达页数上限 toast「已连续加载 8 页仍未到达…」，两档可区分。
  - 聊天滚动时 activeTurnKey 更新为视口顶部最近轮 key。
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 跳转循环单次 ≤8 页上限（≈800 条日志）防死循环；到上限不报错，可再次点击续跳。
  - suppress ref 必须 try/finally 恢复 false，任何异常路径不得永久抑制触顶自动加载。
  - 跳转/联动锚点查询一律 data-turn-key 属性精确匹配（CSS.escape），禁止类名匹配（FR-07）。
  - 零后端改动（D-004）：不碰后端、不改 api-types、不新增独立请求/缓存（复用既有 runsMeta 与 handleLoadEarlier）。
  - 本卡不做 TickRail 布局挂载与 mobile Drawer（分别属 task-05/task-06），不动 sessions-portal / dialog 宿主渲染分支。
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
