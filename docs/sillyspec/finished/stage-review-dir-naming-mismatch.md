# stage-review 目录命名两代格式不一致 + register-stage-review --refresh-hash 全程不可用

> 记录时间：2026-10-15 · 来源变更：2026-10-14-admin-server-status（brainstorm/plan/execute 三阶段连环实证）
> 状态：活跃坑（人工搬运 review.json 绕过可靠，待工具修复）

## 现象

Stage Review Gate 要求子代理把 review.json 写到 `.sillyspec/.runtime/stage-reviews/<目录>/`，
但**目录命名规则在文档、marker 值、实际校验逻辑三方不一致**，导致 review.json 反复归位失败：

| 信息源 | 给出的目录形态 | 实测结果 |
|---|---|---|
| skill 文档（sillyspec-brainstorm/plan/execute SKILL.md） | `stage-reviews/brainstorm-review-<stage-review-run-id>/`，且"run-id 必须 review- 前缀" | 按 marker 值 `review-2026-10-15-000708` 代入 → 写到 `review-2026-10-15-000708/` → **CLI 找不到** |
| marker 文件值 | `review-2026-10-15-000708`（带 review- 前缀） | 同上 |
| CLI 实际期望（旧存量目录旁证：brainstorm-review-2026-09-25-115650 等） | `<stage>-review-<纯时间戳>`（如 `brainstorm-review-2026-10-15-001431`） | 归位后 gate 通过 |

生产实证（本变更三次撞坑）：
1. brainstorm：子代理写 `review-2026-10-15-000708/` → --done 拦「Stage Review 未过」；`register-stage-review --refresh-hash` 报"marker review-2026-10-15-000708 无对应 run"→ 不带 --refresh-hash 重注册得新 run-id（marker 变 review-2026-10-15-001431）→ 人工把 JSON 搬到 `brainstorm-review-2026-10-15-001431/` → 过；
2. plan：同样流程再撞一次（`plan-review-review-2026-10-15-001631/` → 搬 `plan-review-2026-10-15-001631/`）；
3. execute：学乖后直接赌 `<stage>-review-<时间戳>` 命名 → 一次过。

## 连带缺陷：--refresh-hash 完全不可用

`register-stage-review --change <名> --stage <段> --refresh-hash` 两次尝试全部报
「找不到 brainstorm/plan 的既有 review.json（marker … 无对应 run）」——它按自己的期望目录名找，
而 review.json 在 marker 值命名的目录里。功能等于不存在，只能人工改 docHash 或靠
gate 的"仅 docHash 失配自动机械重算放行"兜底（后者有效，救了两次）。

## 影响

- 每个走独立评审的变更浪费 2-4 轮 CLI 往返（拦下→看 marker→猜目录→搬运→重跑）；
- 子代理按主代理转述的（文档口径）路径写文件，主代理不知道实际期望路径时陷入盲猜；
- --refresh-hash 文档承诺的一键重算代填从未生效。

## 绕过

1. 写 review.json 前先 `ls .sillyspec/.runtime/stage-reviews/` 看存量目录命名（`<stage>-review-<纯时间戳>` 为实测权威）；
2. 撞 gate 报缺 review.json 时，报错文案里的路径才是权威——直接把 JSON 搬过去；
3. docHash 失配不慌：gate 检测「仅 docHash 失配」会自动机械重算放行，verdict 保留。

## 修复建议

1. 统一三方口径：marker 值 = 期望目录名（一个真相源），或 gate 报错文案/文档/marker 同步为同一格式；
2. gate 拦截时直接 echo「期望完整绝对路径」（现在部分场景有，部分没有），主代理照抄即可；
3. 修 --refresh-hash 的目录解析（按 marker 值或按 stage-reviews/ 下最新 <stage>-review-* 目录找）。

## 处置记录（2026-10-15）

**已修**（sillyspec `2026-10-15-pitfall-batch-clearance`，归档 a493aef1）：

- **读侧归一容错**：stage review 目录读取按「规范 `<stage>-<runId>` → 双前缀错位
  `<stage>-review-<runId>` → 裸 runId」三态探测 review.json 在场性——历史错位文件对
  gate / --refresh-hash / autoRefresh 天然可用，不再人工搬运；
- **写入侧恒规范路径** + SKILL 文档口径同步统一（三方不一致的文档侧收口）；
- **--refresh-hash 修复**：目录解析走同一读侧归一，「marker 无对应 run」假报错消除。

坑内建议②（gate echo 完整路径）此前已部分在场，读侧归一后期望路径恒规范可照抄。归档。
