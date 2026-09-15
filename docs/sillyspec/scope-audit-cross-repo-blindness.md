# scope-audit 跨仓清单盲区 + 实际侧窗口污染（脚手架/并行文件全计入「计划外」）

- 记录日期：2026-09-15（同日拿到 `--json` 明细后修订，52 个「计划外」逐行核实）
- sillyspec 版本：3.28.9（`scope-audit.js` / `verify-postcheck.js` / `change-list.js` / `worktree-apply.js`）
- 实证场景：workspace f85a6650（EHS_BACK，`E:\PZwangge\pollute`）变更
  `2026-09-15-ehs-reward-punishment`，对账结果「计划内 1 / 计划外 52 / 计划未动 41，
  94 文件 +6471/−0，锚点 214151b」，note 报「快照缺失…实时开放区间…实际侧另有 14 个
  文件按他者会话声明退栈未进本表」。

## 现象

多仓变更（design 文件变更清单分「main 仓 / sub-grid-security / spdemo」三段，20/13/9 个
文件）在主仓跑 scope-audit，三态严重失真：跨仓段全部落「计划未动」；实际侧窗口扫进
大量与变更无关的文件落「计划外」；已写盘的 planned 文件也因「他者会话声明」被退栈排
除后显示「计划未动」。

## 「计划外 52」逐类核实（来自 --json rows）

| 类别 | 行数 | 内容 | 定性 |
|---|---|---|---|
| sillyspec 自装 skills | 20 | `.claude/skills/sillyspec-*/SKILL.md` | **工具缺陷**：CLI 自己写进仓的脚手架被算作本变更「计划外改动」 |
| 平台/CLI 标记与元数据 | 13 | `.sillyspec-platform{,-cleaned,-managed,.json}` ×3、`.sillyspec/knowledge/**` ×7、`.sillyspec/local.yaml`、`CLAUDE.md`、`.gitignore`(+4) | **工具缺陷**：同上，工具/平台设施文件 |
| brainstorm 附件 | 8 | `attachments/*`（需求 docx、原型 html、截图、提取 txt）——其中约一半还是 8 月老变更 building-area 的 | 流程产物，半工具半本仓 |
| 8 月老变更遗留 | 6 | `2026-08-28-building-area-fix.sql` + `ServerHandlerTest` + 4 × `BuildingArea*Test`（一直未提交） | **本仓卫生**：老变更停在 verify 未收尾 |
| 垃圾文件 | 4 | `pollute/*/pollute/pollute-service/cp.txt`（路径嵌套错乱，疑似 cp 命令打错产物） | **本仓卫生** |
| 平台 worktree 目录 | 1 | `.worktrees/019771a4/`（目录整行，additions=null——readFileSync 目录 EISDIR 出 null） | 平台设施 + 小 bug（目录不应成行） |

52 行里 rp 功能代码文件为 **0**。真正该对账的活都不可见（见下）。

## 根因（四层，数字全对账）

94 行 = 计划 42 + 实际 53 − 命中 1；41 未动 = 22 跨仓 + 19 主仓 NEW：

1. **实际侧过滤器不排工具自身脚手架（本例 52 计划外中的 34 行）**：
   `filterDeliverableFiles`（worktree-apply.js:59）只排 `.sillyspec/changes/`、
   `.sillyspec/.runtime/`、`.sillyspec/quicklog/`、`meta.json`；`.claude/skills/**`、
   `.sillyspec/knowledge/**`、`.sillyspec/local.yaml`、`.sillyspec-platform*`、`CLAUDE.md`、
   `attachments/**`、`.worktrees/**` 全部放行 → 锚点窗口内工具自装的文件全成「计划外」。
2. **跨仓条目恒「计划未动」（22 行）**：`parseFileChangeListDetailed` 把清单所有子段
   （含 sub-grid-security / spdemo 跨仓段）当主仓路径解析；实际侧只对主仓跑 git。
   verify-postcheck 已有 cross-repo 感知、`_module-map.yaml` 有 `cross-repo:<repo-key>:`
   约定，唯独 scope-audit 不识别。
3. **已写盘的 planned 文件被「他者会话声明」退栈排除（note 自述 14 个）**：同一工作树上
   一个未绑定变更的自由会话（「奖惩功能开发」，当日 09:42 起长期活跃）直写主仓做了 rp
   的活；实际侧 status 源按「声明即归属」把这部分文件退栈，本变更表里只剩「计划未动」。
   工具 note 有提示（「计划未动行先怀疑归属重叠」），但只在 note 里，摘要层不可见。
4. **锚点=开放区间且快照缺失时全程漂移**：baseAnchor 214151b 是 merge-base(main, 分支)，
   窗口 = 锚点→当前工作树，含一切并行演进；execute 未 done 无冻结快照，每次查询都是
   实时开放区间。且本例变更 execute 进行中（20/27）却因 in-place 无 worktree meta 走了
   `form='post-apply'` 的 settled 捷径，note 文案「变更已收尾——已归档或 execute 分支已
   清理」与事实（执行中途）不符，误导排障方向。

## 工具可改进点（待 sillyspec 修复，按本例收益排序）

1. `filterDeliverableFiles` 扩排工具/平台脚手架：`.claude/skills/**`（至少
   sillyspec-*）、`.sillyspec/knowledge/**`、`.sillyspec/local.yaml`、
   `.sillyspec-platform*`、`CLAUDE.md`、`attachments/**`、`.worktrees/**`——或至少
   归入单独「工具/平台设施」桶不占「计划外」。
2. scope-audit 计划侧识别跨仓条目（子段标题 / `cross-repo:` 前缀 / local.yaml repos
   段），标注「跨仓（本表不含）」或按 local.yaml 分仓对账，不恒 untouched。
3. planned(NEW:) 文件若已存在于工作树/锚点（`git cat-file -e` 或盘面 existsSync）但被
   退栈排除 → 该行标注「疑似他者会话已实现（已退栈）」，与「真未动」区分。
4. settled 判定区分「in-place 执行中途」：无 worktree meta ≠ 已收尾；note 文案按真实
   状态生成（执行中途就明说「执行中，实时窗口」）。
5. （平台侧）摘要卡在计划外/未动占比异常时把 note 顶到摘要层——advisory 没问题，问题
   是摘要在无解释时看着像门禁红牌。
6. （小 bug）untracked 目录不应成行（`.worktrees/019771a4/` additions=null 档）。

## 使用侧规避

- 同一工作树不要并行跑自由会话与 in-place 变更；旧变更及时 verify→archive 收口、提交
  遗留测试文件。
- 多仓变更要么拆成各仓独立变更，要么看主仓对账表时只认主仓段 + 无视跨仓「未动」行。
- 「计划外」先按路径前缀分桶（.claude/.sillyspec/attachments = 工具与流程噪音）再看。

## 复核方法

目标机器（daemon 所在机）上跑：
`sillyspec scope-audit --change 2026-09-15-ehs-reward-punishment --json`，
rows 按 verdict 分组、unplanned 按上表前缀分桶；note 中「退栈 14 个」对应文件用
`git status` + 自由会话声明核实。
