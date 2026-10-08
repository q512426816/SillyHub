---
name: sillyspec:flow
description: 轻量变更（默认快道）：需求明确的小/中改动两步收口——flow start → 直接干活 → flow done
---
# 何时用

需求已含决策的改动：改什么、成功标准说得清（能列 1-3 条可验证标准）。需求不清晰先走 brainstorm（完成后 flow start 收编续跑）；跨模块取舍/Wave 编排/设计期人机对抗走完整五阶段（run-brainstorm 等卡）。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
# ① 立项 + 锁基线（--input 引号内换行合法，可照抄；缺「成功标准」条目会被清晰度门拦下）：
sillyspec flow start --change <变更名> --input "<动机与背景>

成功标准：
- <可验证标准>"
# ② 直接干活：改代码写测试；填 design.md 四节（空节 flow done 拒收；列改动文件用独立「## 文件变更清单」节）；
#    tasks.md 是你的工作队列——机器种子改写为实现步骤（每行做什么+怎么验证，保持 `- [ ] task-NN:` 行形态），
#    执行循环：Working on task N/M → 做一件 → 测试绿后当场勾一格（sillyspec task tick --change <名> --task task-NN
#    即时回显进度与下一任务）→ 下一行；每格勾选要有对应提交（消息带 task-NN），一把勾收口被拒。
#    交付代码显式 pathspec 提交（patch 冻结面=baseline..HEAD 提交面，未提交不进审计件）
# ③ 收口（CLI 亲自实测 test/lint + 独立评审定档 + patch 留档）：
sillyspec flow done --change <变更名>
# 断点恢复 / 随时查进度：
sillyspec flow status --change <变更名>
```

# 防坑清单

- --input 的「成功标准：」必须独立成行，其后每行一条 `- <可验证标准>`——格式不对 CLI 会拦下给两选一（头脑风暴预段 / 确认输入已含决策），照提示走即可。
- 触及 src/test 的改动 flow done 会亲自实测 local.yaml 的 test/lint（实测失败阻断收口，修好重跑即可）——想省一轮就先自跑。
- 轻量→完整转道是用户决策：征得同意带 `--upgrade-thick` 重启；实测失败自动升厚。
- 显式 pathspec 提交（`git commit -m "..." -- 文件…`），禁 git add -A。

# 边界声明

本卡不含步骤内容——干活与收口的具体指令由 `flow start` / `flow done` 按当前状态实时渲染（含三断点纪律、评审任务书、FR 对账）。本卡只管入口与防坑。
<!-- sillyspec-card: v3.32.0 sha256=8b8105282919db7993a91342e0e3672fa66d13ec2be908e2ad75f798b9b992ce -->
