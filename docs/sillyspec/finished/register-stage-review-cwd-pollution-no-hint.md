# register-stage-review 在非仓库根 cwd 下报「主审查文档不存在」且无 cwd 提示

- 状态：活跃坑（工具侧待改进；使用者侧已由 CLAUDE.md 规则 22 覆盖）
- 首踩：2026-09-25 R16-SF 会话A（变更 2026-09-25-observation-events-v3-r16sf，plan 阶段 stage review 注册）
- 现象：bash 工作目录持久化停在 `.sillyspec/changes/<变更名>/tasks/` 时执行
  `sillyspec register-stage-review --stage plan`，报错：
  `❌ [plan] register-stage-review: 主审查文档不存在 C:\…\tasks\.sillyspec\changes\<变更名>\plan.md（plan 审 plan.md），无法算 docHash`
  ——路径是 cwd 相对拼接出的事务性错误路径，plan.md 实际存在。
- 根因：register-stage-review 以当前 cwd 解析变更目录相对路径（其他子命令如 run/gate
  有仓库根锚定或容忍），叠加 bash `cd` 持久化后违反「CLI 一律在主仓库根目录跑」铁律（CLAUDE.md 规则 22）。
- 绕过：回仓库根重跑即成功（实测 review-2026-09-25-010131 正常注册）。
- 工具侧建议：register-stage-review（及其同类一次性算 docHash 的命令）加 cwd 防御——
  检测到拼接目标不存在时，提示「当前 cwd=<X> 不在仓库根，请回仓库根执行」并给出仓库根推断值；
  或统一以进度库/锚文件反解仓库根，与 run/gate 同源。
- 关联：docs/sillyspec/finished/quick-test-gate-frontend-lint-tempdir-no-nodemodules.md（同为 cwd/环境类坑）

## 处置记录（2026-09-25）

**工具侧修复（sillyspec 仓工作树，未提交）**：按「修复方向·统一反解仓库根」落地——
`src/stage-review.js` `registerStageReview` 的 specBase 回退从 `join(cwd,'.sillyspec')`
改为 `resolveSpecDir(cwd)`（run/shared.js 单一真相源向上找根，含 home/tmpdir 拒绝守卫），
与 run/gate 同源、与 shared.js 既有规范写法 `platformOpts?.specRoot || resolveSpecDir(cwd)`
一致。坑现场形态（cwd 停在 `.sillyspec/changes/<变更>/tasks/`）向上找到仓库根
`.sillyspec`，注册成功且产物落根 `.runtime/stage-reviews/`；平台模式 specRoot 仍优先。

**测试证据**（sillyspec 仓）：新增 `test/register-stage-review-cwd-deep.test.mjs` 4/4
（深 cwd 注册成功 + 产物落根 + 裸目录 fail-fast 保留不静默猜根）；回归
register-stage-review-refresh / platform-register-stage-review / stage-review-checklist /
align-execute-review-gate 12/12 全绿。

**遗留（边界，非本坑）**：平台指针 `.sillyspec-platform.json` 的查找本身按 cwd 精确
定位（resolvePlatformOpts 设计语义，影响全部子命令非本命令独有）——深 cwd 下指针
 miss 走本地回退。指针向上找根涉及接管判定语义，另立设计项不动。
