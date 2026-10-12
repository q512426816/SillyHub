---
author: qinyi
created_at: 2026-10-12 20:55:00.000Z
---
# 任务注册表（Tasks）— 2026-10-12-session-defects

<!-- Wave=并行屏障：同 Wave 内任务文件正交无依赖。W1(波1 数据管道): 03/04/06/11；W2(波2 起): 01/07/10；W3: 02/09；W4: 05/08；W5: 12。W1→W2 有波界验收门（详见 plan.md）。依赖详见 plan.md。 -->

- [x] task-01: F2a wire 事件时间戳——daemon types/event-wire 补 timestamp 捕获（含 SSE 同步）+ backend submit_steps 优先取值（钟差>5min/非法回落 st.now）+ 双端测试 (depends_on: —)
- [x] task-02: F2b 消息碎片合并——NEW message-coalescer.ts（message id 缓冲/TTL 冲刷）+ event-wire 接入 + segment_id 残留核查 + 单测 (depends_on: task-01)（commit 287e3b0c，13+22 用例绿；裁决 D-010@v1：批处理道接线留 follow-up，interactive 面由 override 协议覆盖且 backend 链路审计无缺口）
- [x] task-03: F3 幽灵行——根因调查（生产成对模式复现测试先红）→ 修复 agent_task_store（终态保护+同名合并/重映射）→ 复现测试转绿 (depends_on: —)（commit 0526ded8，33 用例全绿；根因=tool_use 派生 running 以 call id 冒名 task_id，裁决 D-009@v1）
- [x] task-04: F5a config_snapshot 补齐——create.py 绑定前窗口 + inject.py 切换后回写 model/provider_name/profile_name + 测试 (depends_on: —)（commit 830f34d6，62 用例全绿；落点=inject.py 非切换轮默认供应商回填，create 现状语义零回归）
- [x] task-05: F5b 打断工具调用补日志——daemon 中断/拒绝路径核查 tool_call 发射时序并补发 + 测试 (depends_on: task-02)（commit f8ded76d，37 用例绿+typecheck；落点=event-wire decline 分支补发 tool_call 行（interrupt abortAll 全 deny 经同一事件形态覆盖），turn-control 无需改动）
- [x] task-06: F7 导出与任务列表去重——export.py + session_insights.py 同 session 同名取最新真实终态行 + 测试 (depends_on: —)（commit 696f488a，去重 helper 9 用例+导出回归 53 全绿；running 行透传防误杀在途实例）
- [x] task-07: F1a context_overflow 归因——daemon model-error types/classifier + backend schema Literal（实测未知值行为）+ pnpm gen:types + frontend normalize/错误卡 + 三端测试 (depends_on: —)（commit 4dabdc28+0841ede2，daemon 42+frontend 48+backend 13 用例绿；backend 落点=model_error.py StrEnum 非 schema.py，R-05 宽松校验已落地）
- [x] task-08: F1b 自动恢复编排——auto_resume context_overflow 分支（compact_session 调用+内联直插 AgentSessionScheduledMessage 重放+熔断=2+AppError 引导不吞）+ pytest 用例 (depends_on: task-07, task-09)（commit 954cb88f，23 用例绿+mypy 过；rollback 过期属性的 MissingGreenlet 已用标量捕获+get 重载解决）
- [x] task-09: F1c 会话状态语义——调查 47e2ff1a 翻 failed 真实路径（前半，产出决定 task-08 落点）→ 修正（恢复预算内不终态化）+ 测试 (depends_on: task-07)（commit 6be2a8b4，21 用例绿；根因=run 级变更归因使 change_id≠NULL 致多轮保护失效，裁决 D-011@v1）
- [x] task-10: F4 策略路径解析——shell-paths flag 过滤（含 PS/CMD）+ path-utils anchor 三层贯通（path-utils→filesystem-policy→write-guard 四分支）+ deny 双拼写文案 + vitest (depends_on: —)（commit e9975101，policy 面 116 用例全绿+typecheck 过）
- [x] task-11: 记档——NEW docs/sillyspec/cli-cwd-coupling.md + NEW docs/sillyspec/deps-gate-offline-fragile.md (depends_on: —)（commit eb3f9236；注：曾出现 task-01/04 被未知写者误勾（watcher 21:24 checked 0→2，无对应提交），已纠正——若复现记 sillyspec 工具缺陷）
- [x] task-12: 收口验收——相关面测试全绿 + ruff/mypy/tsc/vitest lint 门 + 对照 design 文件清单验收 (depends_on: task-01..task-11)（backend 221 + daemon 265 + frontend 157 用例全绿；backend ruff/format/mypy 过、daemon tsc 过、frontend tsc 过；lint 存量警告 566 条均非本变更引入）
