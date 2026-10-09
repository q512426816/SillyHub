---
author: qinyi
created_at: 2026-10-09 02:04:06
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
工作区初始化链路与"能用"之间有三个断点：初始化不写 skill 文件（`--no-skills` 关闭了 CLI 复制段，机器上的 codex/zcode 等非 claude agent 拿不到技能）；初始化操作后置（创建完要用户自己进详情页找按钮）；未初始化状态无行动引导（只有徽标没有"不能用"的明示）。

## 关键问题
1. **skill 单端分发**：技能只写 `.claude/skills`（skill-manager 链路），多 agent 机器上其它端（zcode/codex 等）零技能——用户明确要求"机器上有什么 agent 就生成什么类型的 skill，多种全写、不支持跳过、都不支持写 claude code 类型"。
2. **创建与初始化割裂**：创建成功只刷新列表（workspace-scan-dialog.tsx:93-98），新工作区处于不可用状态却无自动收敛路径，用户必须知道"要去详情页点初始化"这个隐性知识。
3. **白名单漂移**：daemon 端 `SILLYSPEC_VALID_TOOLS` 6 值落后 sillyspec CLI v3.32.2 的 7 值（缺 zcode），且老版本 CLI 对未知 tool 静默忽略，存在"init 成功但技能没落"的暗坑。

## 变更范围
- daemon：`runSillyspecInit` 去掉 `--no-skills`（恢复 CLI skills 复制段按 `--tool` 多端写入）；`SILLYSPEC_VALID_TOOLS` 补 zcode；版本门控 ≥3.26.8 → ≥3.32.2。
- 后端：一处修复——init lease 以 failed 完成时禁止回写 `init_synced_at`（现状失败被误标"已初始化"，Grill 审查实证；也是前端轮询语义的前置）。
- 前端：创建弹窗两步状态机（创建 → 自动初始化 → 完成/失败不回滚）；详情页未初始化引导 Alert。

## 不在范围内（显式清单）
- 不做后端硬门禁（未初始化不返回 409/403）
- 不改 skill-manager 链路（平台自定义技能仍单端 .claude/skills 分发）
- 不做平台自定义技能（CustomSkill）的多端分发
- 不为存量已初始化工作区重跑初始化或回填多端 skill
- 不改 create 接口语义（初始化由前端串行触发）

## 成功标准（可验证）
- 探测到 [claude, zcode, codex] 的机器跑 init 后，项目根下 `.claude/skills`、`.zcode/skills`、`.codex/skills` 三端均出现 `sillyspec-*` 技能目录；探测结果全不支持时仅 `.claude/skills` 出现（兜底 claude）。
- daemon 机器 sillyspec 版本 < 3.32.2 时 init 失败并返回 `sillyspec_init_cli_too_old`。
- 创建弹窗（已绑 daemon）在创建成功后自动进入初始化进度，`init_synced_at` 非空后展示完成态；初始化失败/超时时工作区已存在且弹窗明示"已创建成功、可稍后手动初始化"。
- 详情页成员未初始化时出现引导 Alert 文案；已初始化时无 Alert（现状零回归）。
