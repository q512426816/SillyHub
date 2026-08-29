---
id: task-13
title: '【跨仓 sillyspec】X1 墓碑上报 + X3 步骤开始上报 + X4 任务边界 triggerSync'
title_zh: '【跨仓 sillyspec】X1 墓碑上报 + X3 步骤开始上报 + X4 任务边界 triggerSync'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-04']
blocks: []
repo: sillyspec
requirement_ids: [FR-10]
decision_ids: [D-004@v1, D-007@v1]
expects_from:
  - 'task-04：progress 上行 changes[].status=deleted 的写路径处理（置 location=deleted + 已删 key 409 code=change_deleted 拒收语义）'
allowed_paths:
  - 'src/run/shared.js'
  - 'src/sync.js'
  - 'src/stages/execute.js'
  - 'test/platform-tombstone-and-activity-report.test.mjs'
goal: >
  sillyspec CLI 三处上报增强——X1 删除/归档上行 status=deleted 墓碑（收敛加速器）、
  X3 步骤开始补推一次 progress、X4 execute 每任务完成调 triggerSync——让平台
  「最后信号」真实反映 CLI 在跑（design §5.5 / §8.2 Layer 2，平台侧不硬依赖）。
implementation:
  - 'X1 墓碑上报：删除/归档触发点（unregisterChange 调用链、实体目录删除、归档收尾——run/command.js:1191、run/complete-handlers.js:292/:351 一带的 triggerSync 周边，接线统一落 src/run/shared.js triggerSync :587 附近）progress 上行载荷 changes[].status=deleted（对齐既有 archived 状态语义；载荷构造/支持落 src/sync.js）→ 平台写路径处理由 task-04 交付'
  - 'X3 步骤开始上报：CLI 状态机已维护步骤 in-progress（六表 payload steps[].status 已含 in-progress），但现有推送时机仅在每步 --done 的 triggerSync——步骤启动时同端点同结构补推一次 progress；真实效果=last_pushed_at 刷新（投影 current_step_status 对下一 pending 步本就推导为 active，X3 不改变其值，只让停滞判定可信，design §8.2）'
  - 'X4 任务边界上报：src/stages/execute.js per-task 派发循环每完成一个任务（T1..Tn）调一次 triggerSync → last_pushed_at 以任务粒度刷新（tasks.md 勾选状态走文件同步 + task 模块 reparse，无需新端点）'
  - '推送纪律：每次一轻量 JSON POST；CLI 单进程顺序推送，base_ts 进程内单调无乐观锁冲突；多用户同 key 双 CLI 交错冲突由既有 base_ts 409 + resolve 机制消化（R-13）'
  - '后端零改动（upsert 对 in-progress 步骤裸 JSON 透传，已核实 design §8.2）；未连接平台时沿用 Best Effort 静默跳过语义'
  - '新增测试 test/platform-tombstone-and-activity-report.test.mjs（node:test）：X1 载荷含 status=deleted、X3 步骤开始即推、X4 每任务一次 triggerSync、既有 --done 推送路径回归'
acceptance:
  - '归档/裸删后上行载荷含 changes[].status=deleted（测试断言 payload 形状）'
  - '步骤启动即有一次 progress POST（steps[].status=in-progress，无 --done 也推）；last_pushed_at 刷新'
  - 'execute 每完成一个任务各触发一次 triggerSync（per-task 粒度）'
  - '既有每步 --done 推送路径行为不变（回归）；未连接平台静默跳过不崩'
verify:
  - 'cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/check-syntax.mjs'
  - 'cd C:/Users/qinyi/IdeaProjects/sillyspec && node --test test/platform-tombstone-and-activity-report.test.mjs'
constraints:
  - '跨仓任务：全部改动相对 sillyspec 仓根（C:/Users/qinyi/IdeaProjects/sillyspec），禁止修改主仓任何文件；SillySpec CLI 一律在主仓根目录跑（CLAUDE.md 规则 22），读代码用绝对路径或 git -C'
  - '与 task-14 同改 src/sync.js 但分属不同 Wave：本任务只动上行载荷构造，不新增 pullSpecBundle（归 task-14/W5），避免改动点冲突'
  - '不实现心跳（Layer 3 = Non-Goal §8.3）；不动 daemon；平台闭环不依赖本任务（旧 CLI 行为=现状，渐进增强）'
  - '只跑本任务相关测试（node --test 指定文件），该仓全量 npm test 留 CI'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
