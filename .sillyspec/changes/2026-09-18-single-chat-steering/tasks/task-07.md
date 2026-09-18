---
id: task-07
title: 'frontend 忙轮发送引导状态（steered 响应→引导中/已引导气泡；手写镜像 sessions.ts 补字段；page/dialog 双挂载）'
title_zh: 'frontend 忙轮发送引导状态（steered 响应→引导中/已引导气泡；手写镜像 sessions.ts 补字段；page/dialog 双挂载）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
expects_from:
  task-05: 'SessionInjectResponse 出参新增 steered 布尔（backend router 层映射 result.mid_turn，忙轮注入成功=真）'
allowed_paths:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
target_files:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
goal: >
  前端消费 task-05 的 steered 响应，把单聊忙轮发送渲染为「引导中→已引导」气泡并在轮终止未投递时收敛终态（design.md Wave C1 / FR-05 / 原型 §1 §3），page 与 dialog 双挂载同步实现，不新建任何持久化状态。
implementation:
  - 手写镜像补字段：frontend/src/lib/daemon/sessions.ts:274 SessionInjectResponse 为手写接口（不在 pnpm gen:types 生成链内，gen 覆盖不到必须手补）——新增 steered 可选布尔字段并注释映射语义（true=已 mid-turn 注入活跃轮，不建新 run）
  - page 挂载点：session-panel-page.tsx injectSession 调用面（:2168 空闲直发 / :2234 / :2739 追问路径）读取 resp.steered——true 时该消息本地渲染「引导中」虚线气泡+脉冲+「本轮工具间隙投递」提示（原型 §1/§3），不进排队条；false/undefined 走现有排队条目路径（零回归）
  - 状态机收敛（原型 §3 状态机）：SSE 收到该消息 user_input 留痕行 → 转「已引导」终态（普通用户气泡+已投递小标，历史回放同态，留痕复用群聊 inject 既有链路）；活跃轮终止（完成/中断/失败）仍未收到留痕行 → 气泡收敛为终态提示（如「本轮已结束，未投递」），不永久停留（design.md R-04）
  - dialog 挂载点：session-panel-dialog.tsx（:971/:975/:1044 injectSession 调用面）与 page 同步同一状态逻辑——公共状态推导/渲染 helper 抽到既有 page-helpers.tsx / dialog-helpers.ts 复用，避免双份漂移
  - 「引导中」为纯展示态：不动 useMessageQueue 队列真相、不新增状态库；虚线/脉冲样式走既有主题 token（brand-* 语义阶），blue/ai-native 双主题下可用
acceptance:
  - sessions.ts:274 SessionInjectResponse 含 steered 可选布尔字段且注释说明映射来源，pnpm exec tsc --noEmit 通过
  - page 与 dialog 双挂载点在忙轮发送且响应 steered=true 时均渲染引导中虚线气泡；SSE user_input 留痕行到达后转已引导终态；轮终止未投递时收敛为终态提示，无永久停留的引导中气泡
  - steered=false/undefined 的忙轮发送仍走现有排队条路径，发送/排队/停止按钮既有行为与改造前一致（零回归）
  - 历史回放（刷新后重载日志）中已引导消息与实时路径同态（普通用户气泡+已投递小标）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-dialog.test.tsx src/components/daemon/__tests__/session-panel-prompt.test.tsx
constraints:
  - api-types.ts 为生成产物禁手改，其重生成归 task-09；本 task 仅手补 sessions.ts 手写镜像 steered 字段（与后端契约语义须一致）
  - 不新建持久化生命周期（无新表/新状态列/前端不新增状态库），「引导中」为纯展示态，队列真相仍归 useMessageQueue
  - UI 文案中文；样式走主题 token（brand-* 语义阶，双主题可用）；代码兼容 Windows/Linux/macOS
  - 停止按钮 interrupt 语义、带切换维度消息排队/409 语义零回归——不修改 use-message-queue.ts 既有消费逻辑与排队条目编辑/删除/拖拽行为
  - 禁止跑全量测试，仅跑本 task 相关测试文件（全量留 CI）；测试断言收口归 task-09，本 task 不改测试文件
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
