---
name: sillyspec:flow
description: 轻量变更（默认快道）：需求明确的小/中改动——flow start → 补 spec 面 → 批准 → 干活 → flow done
---
# 何时用

需求已含决策的改动：改什么、成功标准说得清（能列 1-3 条可验证标准），且成功标准来自用户原话/既有文档转写——要靠你替用户拟标准＝需求不清晰，先走 brainstorm（完成后 flow start 收编续跑）；跨模块取舍/Wave 编排/设计期人机对抗走完整五阶段（run-brainstorm 等卡）。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
# ① 立项 + 锁基线（--input 引号内换行合法，可照抄；缺「成功标准」条目会被清晰度门拦下）：
sillyspec flow start --change <变更名> --input "<一句 10-30 字中文概括（首行即变更标题，硬区间 10-30 必须、建议 ~20 字）；随后动机与背景

成功标准：
- <可验证标准>"
#    极速变体：用户显式说「极速/别验证/只要 spec 和代码」类原话时才加 --turbo（仅用户显式触发，
#    禁止你自行启用）——flow-state 留痕，收口跳过实测与重仪式门（hunk/dirty/ui 探针/评审），
#    spec 结构校验、tasks 全勾、ledger、patch 冻结、distill、归档照常；升厚即失效恢复全量仪式。
# ② 补 spec 面（动码前）：requirements FR 行为句（强度词）+ 测试绑定行、design.md 四节作答
#    （空节 flow done 拒收；列改动文件用独立「## 文件变更清单」节）；tasks.md 改写为工作队列
#    ——机器种子改写为实现步骤（每行做什么+怎么验证，保持 `- [ ] task-NN:` 行形态）。
#    然后过断点①：摘要给用户看 → 用户运行 sillyspec flow approve --change <名>（批准留痕；
#    用户显式说「直接跑完」→ 重跑 start --autopilot 豁免）。批准是动码前置义务，不是收口补救。
# ③ 干活（已批准）：写测试、改代码（按层适用——纯逻辑先写、行为契约断用户所见、样式/纯配置不写）；
#    执行循环：Working on task N/M → 做一件 → 测试绿后当场勾一格（sillyspec task tick --change <名> --task task-NN
#    即时回显进度与下一任务）→ 下一行；每格勾选要有对应提交（消息带 task-NN），一把勾收口被拒。
#    交付代码显式 pathspec 提交（patch 冻结面=baseline..HEAD 提交面，未提交不进审计件）
# ④ 收口（CLI 亲自实测 test/lint + 独立评审定档 + patch 留档；--turbo 变更自动跳过实测与重仪式门）：
sillyspec flow done --change <变更名>
# 断点恢复 / 随时查进度：
sillyspec flow status --change <变更名>
```

# 防坑清单

- --input 的「成功标准：」必须独立成行，其后每行一条 `- <可验证标准>`——格式不对 CLI 会拦下给两选一（头脑风暴预段 / 确认输入已含决策），照提示走即可。
- 预段同意门：上个轻量变更被 route-hindsight 标记「疑似该走预段未走」时，全新 start 会被拦下要求显式选道——确认需求已含决策（成功标准来自用户原话/文档转写）加 `--no-prestage` 声明留痕；要靠你拟标准就走 brainstorm 预段，完成后收编（标记自动消费）。
- 触及 src/test 的改动 flow done 会亲自实测 local.yaml 的 test/lint（实测失败阻断收口，修好重跑即可）——想省一轮就先自跑。
- 轻量→完整转道是用户决策：征得同意带 `--upgrade-thick` 重启；实测失败自动升厚。
- 极速模式（--turbo）触发判据：仅用户显式极速原话（「极速/别验证/只要 spec 和代码」类）才携带——你不得自行启用（实证核验是默认价值，fast 是用户让渡的例外）；跳过面只覆盖验证仪式，spec 面与证据面（patch/distill）全保留；收口输出会显式标注「本次收口不含测试客观核验」。预段组合极速：头脑风暴预段走轻量跑判定（需求已收敛直书结论）+ 单轮合并问询 + burst 一次 --done，收编时若用户要求极速则 start 带 --turbo。
- 显式 pathspec 提交（`git commit -m "..." -- 文件…`），禁 git add -A。

# 边界声明

本卡不含步骤内容——干活与收口的具体指令由 `flow start` / `flow done` 按当前状态实时渲染（含三断点纪律、评审任务书、FR 对账）。本卡只管入口与防坑。
<!-- sillyspec-card: v3.33.4 sha256=039b265a0653061367175e9055fea105983fdcc2eeb87294335bf08b6398b812 -->
