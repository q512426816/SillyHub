---
id: task-08
title: 'frontend 队列条 ⚡ 引导语义 + 降级标注（消费 task-06 的 dispatch_mode 三态；message-queue-bar + provider-caps 数据源）'
title_zh: 'frontend 队列条 ⚡ 引导语义 + 降级标注（消费 task-06 的 dispatch_mode 三态；message-queue-bar + provider-caps 数据源）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P1
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-03, FR-05, FR-02]
decision_ids: [D-001@v1]
expects_from:
  task-06: 'QueueDispatchNowResponse.dispatch_mode 三态 Literal["steered","interrupted","dispatched"]（interrupted 旧字段保留兼容不删）'
  task-01: 'frontend/src/lib/provider-caps.ts PROVIDER_CAPS 生成镜像含 steering 第 14 键（pi/claude/codex=true、cursor/未知=false）'
allowed_paths:
  - frontend/src/components/daemon/message-queue-bar.tsx
target_files:
  - frontend/src/components/daemon/message-queue-bar.tsx
goal: >
  队列条 ⚡ 立即发送的展示语义从「打断当前轮」改为「引导注入当前轮」（design.md Wave C2 / FR-03），不支持引导的引擎 chip 可见化降级标注（FR-05 降级场景 / FR-02 能力数据源），能力判断全部来自 provider-caps.ts 生成镜像，零新增手写能力源。
implementation:
  - ⚡ title 两态文案更新：frontend/src/components/daemon/message-queue-bar.tsx:353-367 Tooltip 文案 pending 态由「打断当前轮，立即发送这条」改为「立即引导进当前轮（不打断）」，failed 态维持「立即发送这条」；:16 / :103 / :350 三处注释与实现同步修正（注释与实现不一致是万恶之源）
  - 降级标注（FR-05 降级场景）：provider 不支持引导（provider-caps.ts steering=false，未知 provider 默认 false）时队列条渲染标注 chip「该引擎暂不支持引导」——能力数据源仅用生成镜像 frontend/src/lib/provider-caps.ts，禁手写能力常量/第 4 源（Grill P2-6）
  - dispatch_mode 三态消费边界：组件保持纯展示、不 fetch、不消费 dispatch_now 响应体——⚡ 点击后条目收敛统一走 SSE/load（沿用 2026-08-31-session-queue-ux R-04「不本地造已打断/已发送态」原则）；dispatch_mode 三态语义（steered=不打断注入/interrupted=打断接力/dispatched=空闲直发）体现在 title 文案与降级标注的对照关系上，旧 interrupted 字段不消费不删（frontend/src/hooks/use-message-queue.ts:22? 现不消费响应）
  - provider 标识获取：降级判断所需的会话 provider 经组件 props 传入（沿用 entries/max 既有传参模式），不在组件内新开数据链
  - 原型对照：prototype-single-chat-steering.html §2「⚡ 立即发送语义对照」（不打断→引导注入当前轮、工具间隙投递）与 §3 降级行为为验收参照
acceptance:
  - ⚡ pending 态 title 显示「立即引导进当前轮（不打断）」，failed 态维持「立即发送这条」；message-queue-bar.tsx 内三处相关注释与实现一致
  - 不支持引导的 provider（含未知 provider 默认 false）会话中队列条渲染「该引擎暂不支持引导」标注；支持引导的 provider 不显示该标注
  - 组件仍为纯展示（不 fetch、不持队列真相、不消费 dispatch_now 响应体），既有 props 回调签名不变
  - pnpm exec tsc --noEmit 通过；排队条目编辑/删除/拖拽/重试/队列满提示等既有行为零回归
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/message-queue-bar.test.tsx
constraints:
  - 纯展示组件边界：不 fetch、不持队列真相、不消费 dispatch_now 响应体（收敛统一走 SSE/load）；旧 interrupted 字段保留不删
  - 能力数据源唯一：frontend/src/lib/provider-caps.ts 生成镜像（该文件本身勿手改），禁新建手写能力常量
  - 仅改 message-queue-bar.tsx 一个文件；title 断言同步（message-queue-bar.test.tsx）归 task-09 统一收口
  - UI 文案中文；主题 token（brand-* 语义阶）；兼容 Windows/Linux/macOS；禁止跑全量测试
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
