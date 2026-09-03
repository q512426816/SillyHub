# 跨 Agent 衔接与驾驭能力改进清单

- 创建：2026-09-02（源自 silly大家庭群聊讨论：覃艺发起，sillyspecer + sillyhuber 分析，管理员拍板）
- 状态：进行中
- 认领：sillyspecer（SillySpec 侧 P0-1/P0-2/P1-1/P2-2）、sillyhuber（SillyHub 侧 P1-2/P2-1）
- 设计原则：**CLAUDE.md 变薄的那天，才说明驾驭能力真的上来了** —— 规则下沉成机制，不靠 agent 自律

## 背景

两个 Agent（sillyspecer / sillyhuber）相互分析了 SillySpec ↔ SillyHub 的衔接缺口与 agent 驾驶能力短板，收敛为 6 项改进。共同结论：

1. 衔接问题的本质是**没有单一状态源**（两套账本）与**软约定没有硬校验**（工单靠自觉翻、部署不校验 change 归档态）。
2. 驾驭能力短板的本质是**高阶工具闲置**（knowledge/export/scan/doctor 吃灰 = 同一个坑踩第二遍）与**铁律靠自觉**（--done 前跑测试、quicklog 精修、文档同步都靠 agent 记得）。

## 改进清单

| # | 优先 | 改进点 | 落点 | 状态 |
|---|---|---|---|---|
| P0-1 | P0 | 全局状态 JSON 出口：活跃 change 列表 + 各自阶段/步骤进度 + ghost/滞留标记，统一 envelope（对齐 machine-interface v1 schema），SillyHub 面板直接消费。现状：gate/derive 已有 --json 但仅单变更粒度，progress show 仅有人类可读输出 | SillySpec | ✅ 已完成 2026-09-02（commit a8a100e，`sillyspec progress show --json`） |
| P0-2 | P0 | `--done` 内置 test+lint 硬门禁（覆盖 quick；把 CLAUDE.md 规则 8 从「提醒」变「卡点」） | SillySpec | ✅ 已完成 2026-09-02（commit 93a12bc，quick --done 触及 src/test 时实测 commands.test/lint，失败阻断） |
| P1-1 | P1 | `--root` 参数（或等价机制）钉死项目根，根治「进 worktree 跑 CLI 写出分裂进度库」（治 CLAUDE.md 规则 14 的根因） | SillySpec | ✅ 已完成 2026-09-02（commit e018c4f）——落地为**自动锚定**优于显式参数：resolveEffectiveDir 第四层，linked worktree 内跑 CLI 自动锚回主仓 + warn，零参数零习惯成本 |
| P1-2 | P1 | 工单目录状态化：`docs/sillyspec/` 作为数据源，SillyHub 面板挂「活跃坑」卡片，按认领人主动推送 | SillyHub | 待开工 |
| P2-1 | P2 | 部署记录绑定 change ID；未走完 archive 的 change 上生产直接拦截（硬校验替代软约定） | SillyHub | 待开工 |
| P2-2 | P2 | sync-conflict 状态标红（冲突可见性）+ doctor 自动校验 file-lifecycle 检查清单（文档同步从检查清单变自动卡点） | SillySpec | ✅ 已完成 2026-09-02（commit 693853a）：overview/show/--json envelope 三面透出未决冲突 + doctor D8 lifecycle_doc_staleness 维度 |

## 驾驭能力（不落代码、落习惯的改进）

- doctor 前置：开工前跑一次，别等 node_modules 半坏 / 文档漂移撞上才发现。
- knowledge/export 用起来：同一个坑不踩第二遍，成功方案导出复用。
- 中断恢复走 `progress show` + `resume`，不 commit 半成品。

## 进度记录

- 2026-09-02 sillyspecer：工单落盘；P0-1 开工（走 sillyspec quick 流程）。
- 2026-09-02 sillyspecer：**P0-1 完成**（ql-20260902-002-7f5f，commit a8a100e）。交付 `sillyspec progress show --json`：全局总览 envelope（活跃变更列表 + 各阶段步骤计数 + ghost/stall 标记），SillyHub 面板可直接消费。验证：全量 npm test 338/0、lint 0 告警、doc-ref-check 84 引用全过。**huber 注**：消费入口即 `sillyspec progress show --json`（envelope schema 与 gate/derive 同构，daemon 可只看顶层 ok/errors/warnings）。下一步 P0-2（--done 内置 test+lint 硬门禁）。
- 2026-09-02 sillyspecer：**P0-2 完成**（ql-20260902-003-277a，commit 93a12bc）。quick --done 边界审计后新增 test+lint 硬门禁：changedFiles 触及 src/test 才亲自实测 local.yaml commands.test/lint（复用 verify 阶段实测引擎，含 test_strategy/known_failures/超时语义），任一 failed → step 回 pending + exit 1 重跑不丢进度；纯 doc/配置、未配置命令、brownfield 自动跳过不阻断；逃生门 `SILLYSPEC_QUICK_TEST_GATE=skip`（审计留痕）。验证：新增 21 断言全过、全量 npm test 339/0、lint 449 文件 0 告警。sillyspec 本仓 local.yaml 已配 commands 段启用自监管（dogfood）。下一步 P1-1（--root 参数钉项目根）。
- 2026-09-02 sillyspecer：**P1-1 完成**（ql-20260902-004-0661，commit e018c4f）。落地为**自动锚定**（优于工单原案 --root 显式参数——零参数零习惯成本）：resolveEffectiveDir 补第四层，.sillyspec gitignore 仓的 linked worktree 内跑 CLI（progress/run/status/doctor 全入口）自动锚回主仓 + warn 提示；补齐既有 D-03 守卫（只覆盖有副本）/quick drift 守卫（只覆盖有 guard）均拦不住的「新会话」缺口。**huber 注**：SillyHub 派活钉根的兜底从此不依赖平台侧——agent 在 worktree 里裸跑 CLI 也不会分裂进度库；确要独立建库显式 --spec-dir。验证：新增真实 git worktree fixture 测试 11 断言全过、全量 npm test 340/0、lint 450 文件 0 告警。剩余：P2-1（huber）、P2-2（sillyspecer，sync-conflict 标红 + doctor 自动校验 file-lifecycle）。
- 2026-09-02 sillyspecer（深夜补充）：**B' 方案落地协作 + 残留清理**。① huber 面板联调暴露 P2-2 盲区（非活跃变更上的冲突人类可读总览漏显）→ 补丁已提交（ql-20260902-006-7861，commit 556bcb8，show 汇总加全局冲突兜底段，127/0）；② 本仓（multi-agent-platform）进度库清理（管理员授权）：15 个 ghost 残留已 `doctor --cleanup-ghosts --confirm` 归档 + 11 条未决冲突全部 keep-local 裁决闭环（均为 08-20～08-30 历史已完成 change，本地为事实源）；终态 `active:1（huber P1-2）· conflicts:0 · ghosts:0 · warnings:0`——面板数据源已干净。③ 改进点留档：`platform resolve` 单轮只消一类冲突（进度冲突先闭环、spec 树冲突需再跑一轮同名 resolve），UX 可优化为一次处理两类。
- 2026-09-02 sillyspecer：**P2-2 完成**（ql-20260902-005-3298，commit 693853a）——sillyspecer 侧四项全部交付完毕。① 冲突可见性：`progress show` 总览变更级 🔴 标红 + `--json` envelope 透出 pending_conflicts 并升 warnings（daemon/面板看顶层即知有冲突，fs-only 不查网络）；② doctor 新增 D8 lifecycle_doc_staleness 维度：file-lifecycle.md 落后生命周期代码 git 提交 → WARNING + 同步指引，CLAUDE.md 检查清单从人工 checklist 变自动卡点。验证：+15 断言全过、全量 npm test 341/0、lint 451 文件 0 告警。**工单 sillyspecer 认领项（P0-1/P0-2/P1-1/P2-2）全部 ✅**；余 P1-2/P2-1 归 huber。

## 巡检记录（2026-09-03 定时扫描）

- sillyspecer 认领四项（P0-1/P0-2/P1-1/P2-2）+ 盲区补丁均已在 sillyspec 仓实证（commits a8a100e / 93a12bc / e018c4f / 693853a / 556bcb8 在 main）✅。
- P1-2 / P2-1（huber 认领）仍待开工——本文件保持活跃，不归档。
- 顺带处置：P2-2 关联的 spec 树冲突可见性延伸坑（quicksync 整树冲突粒度过粗）今日已修复归档，见 `finished/2026-09-03-quicksync-conflict-granularity.md`。
