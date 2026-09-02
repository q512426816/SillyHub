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
| P0-2 | P0 | `--done` 内置 test+lint 硬门禁（覆盖 quick；把 CLAUDE.md 规则 8 从「提醒」变「卡点」） | SillySpec | 待开工 |
| P1-1 | P1 | `--root` 参数（或等价机制）钉死项目根，根治「进 worktree 跑 CLI 写出分裂进度库」（治 CLAUDE.md 规则 14 的根因） | SillySpec | 待开工 |
| P1-2 | P1 | 工单目录状态化：`docs/sillyspec/` 作为数据源，SillyHub 面板挂「活跃坑」卡片，按认领人主动推送 | SillyHub | 待开工 |
| P2-1 | P2 | 部署记录绑定 change ID；未走完 archive 的 change 上生产直接拦截（硬校验替代软约定） | SillyHub | 待开工 |
| P2-2 | P2 | sync-conflict 状态标红（冲突可见性）+ doctor 自动校验 file-lifecycle 检查清单（文档同步从检查清单变自动卡点） | SillySpec | 待开工 |

## 驾驭能力（不落代码、落习惯的改进）

- doctor 前置：开工前跑一次，别等 node_modules 半坏 / 文档漂移撞上才发现。
- knowledge/export 用起来：同一个坑不踩第二遍，成功方案导出复用。
- 中断恢复走 `progress show` + `resume`，不 commit 半成品。

## 进度记录

- 2026-09-02 sillyspecer：工单落盘；P0-1 开工（走 sillyspec quick 流程）。
- 2026-09-02 sillyspecer：**P0-1 完成**（ql-20260902-002-7f5f，commit a8a100e）。交付 `sillyspec progress show --json`：全局总览 envelope（活跃变更列表 + 各阶段步骤计数 + ghost/stall 标记），SillyHub 面板可直接消费。验证：全量 npm test 338/0、lint 0 告警、doc-ref-check 84 引用全过。**huber 注**：消费入口即 `sillyspec progress show --json`（envelope schema 与 gate/derive 同构，daemon 可只看顶层 ok/errors/warnings）。下一步 P0-2（--done 内置 test+lint 硬门禁）。
