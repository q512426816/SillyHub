# thin flow done 空冻结面分支不做 design 声明面自证（声明了交付文件却空面归档零告警）

> 记录时间：2026-10-13 · 来源变更：2026-10-12-fire-ledger-form-strict（生产实证：平台工作区「消防设施器材」4e9eb05b，会话 47e2ff1a）
> 状态：已处理（sillyspec 仓两变更修复归档：**2026-10-13-thin-empty-face-crosscheck**——期望修复 0/1/2 全落实〔flow start 横幅注册仓非空出跨仓清单写法行；空面+声明清单未标注条目阻断三处置一次给全+`--accept-empty-face` 签收留痕 flow-state 持久化；planEntries 解析与防呆告警前移到 ownFiles 判空前+嫌疑判定放宽为主仓不存在即点名〕，另加纯跨仓规范标注空面 advisory；**2026-10-13-h2-repo-heading-parse**——`## <注册key> 仓变更` h2 段头在 thin 收口对账解析器可解析〔此前该形态被节扫描截断解析为空，恰是本坑裸前缀写法的诱因之一〕，REPO_SECTION_HEADER_RE 单一源上移 change-list 导出、与 brainstorm 模板/plan-postcheck 覆盖对账/design-facts 核验四处消费对齐。期望修复 3（共享主仓窗口外同名文件探测）未做——会话专属 worktree 已有 scanOrphanFace 覆盖，共享主仓面留待实证需求再立项）

## 现象

变更 `2026-10-12-fire-ledger-form-strict`（改 LedgerForm.js 单文件）经 thin 通道
`flow done` 正常归档成功，但归档目录里 **没有任何 patch 留档**：change.patch、
change-patch.json、scope-audit.json/.patch 全缺。平台资产面（changes assets API）
相应显示 `patch: null`、`touched_modules: []`、`test_rows: []`、`delta: null`。
蒸馏旁证：FR 落伪域 `auto-sillyspec`、决策落 `decisions/unmapped.md`——蒸馏时
可见交付面只剩 `.sillyspec` 治理文件，实现代码不在其中。

时间线：flow start 00:12:31 → 窗口内唯一提交 11f042c（00:22:41，scope-drift
警告只点名 flow-state.yaml——即提交内容全是治理件）→ flow done 约 00:22:42 起
跑 → 归档 00:38:49（中间 15 分钟无事件停滞，为 review 子步采样）。

## 根因

CLI 3.32.7（`src/flow.js` cmdFlowDone patch 子步）的冻结面口径：

- committed = `git diff --name-only baseline..HEAD` 经
  `filterCommittedFace` 过滤（`.sillyspec/` 全剔、只留 `.sillyspec/docs/`）；
- 窗口内只提交了 tasks.md / flow-state.yaml 等治理件 → committed 过滤后为空；
- `git status --porcelain -uall` 无未提交交付文件（或脏面被**他侧变更的声明**
  认领为 foreign，从 dirtyWarned 剔除）→ 脏门静默通过；
- `ownFiles.length === 0` → 走空面分支：一行
  `📦 patch 留档跳过：本变更可归属文件面为空…` → `patchOk = true` → 继续
  review → distill → 归档，全程非阻断（这是 2026-10-12-close-trace-freeze-integrity
  FR-01「空面哨兵恢复有效」的**有意设计**，对真·纯文档变更语义正确）。

缺陷在分支不对称：**「design 声明面自证」（design 文件变更清单 vs 冻结面，
2026-09-25-platform-feedback-batch2 E）只在非空分支、写完 patch 之后执行**。
空面分支不读 design 声明清单。于是最危险的形态——design 明确声明了交付文件、
冻结面却为空（实现根本没进冻结窗口）——反而是**唯一零告警**的形态。本例
design/FR-024 写明「改动面仅 LedgerForm.js 单文件」，冻结面却为空，无任何
warning，归档绿灯。

实现代码为何不在窗口内（2026-10-13 会话导出实证，根因实锤）：

**代码在跨仓，主仓冻结面天然看不到。** 本工作区形态＝主仓（工作区
/mnt/e/crrcdt/sillyWork/2026/消防设施器材，10-10 由会话现场 git init 而来）
+ 三个 local.yaml 注册跨仓；LedgerForm.js 实际交付在**跨仓**
/mnt/e/Web/crrc/sub-grid-security（分支 sillyspec/2026-10-10-fire-equipment，
实现提交 d09478ec + 评审修复 b47d5b36）。工作区主仓窗口内唯一提交 11f042c
内容＝变更四件套 + flow-state.yaml（全部 `.sillyspec/changes/<名>/` 治理件，
scope-drift 警告仅点名 flow-state.yaml 佐证）。两条路都断了：

1. **主仓冻结面为空**：治理件被 filterCommittedFace 全剔（3.32.7
   e45a3904 FR-01 起 `.sillyspec/changes/` 全子树不入冻）→ 空面 → 跳过留档。
   旁证（同会话前几轮变更，3.32.6 及以前收口）：change.patch 尚产出、内容
   只有「变更文档+visual-evidence」——代理在评审任务书里自述「change.patch
   冻结件只含变更文档；代码事实在前端仓」，即跨仓缺口早已存在，只是
   3.32.7 治理面剔除后连文档件都不再产出、缺口从「patch 缺代码」劣化为
   「patch 整体缺席」；
2. **跨仓冻结未触发**：flow.js 跨仓 patch 冻结前提是 design 文件变更清单
   解析出 `e.repo` 标注（段头「## <注册key> 仓变更」/ 子段「### <注册key>」/
   `cross-repo:<key>:` 前缀三选一）。full.json 实证本变更 design 清单实际写的是
   `sub-grid-security/src/routes/Fire/Ledger/LedgerForm.js`（带仓目录名前缀）
   ——未按段头规范，planEntries 无 repo 标注，跨仓对账与 repos[] patch 冻结
   全不触发。**更关键的结构性短路（2026-10-13 full.json + 源码逐行核实）**：
   CLI 3.32.7 本有一条「疑似跨仓声明未按规范标注」防呆告警（flow.js L1631），
   其触发条件（路径主仓不存在 + 首段命中注册仓 key/basename）本变更**完全
   满足**——但该告警连同 planEntries 解析、跨仓冻结、writeCloseTraceArtifacts
   整段挂在 `else`（非空冻结面）分支内（L1528 空面 if → L1531 else），空面
   走 L1529 一行提示即 patchOk=true 短路，**能救场的告警一次都没执行**。
   会话侧叠加输出截断：agent 跑 flow done 一律 `2>&1 | tail -N`（N=10~16），
   首跑（00:22:38）打印的「📦 patch 留档跳过：…若实现代码应在此，先提交后
   重跑」被 tail 截掉（且该句方向性误导——跨仓代码本就不该提交主仓）；断点
   续跑后 patch 子步幂等 skip，连这行提示也永久消失。flow start 横幅源码零
   跨仓字样（会话捕获的输出亦仅剩协议调用两行）。

蒸馏侧连锁：distill 实测面同样只看主仓（跨仓文件在主仓 git 不可见）→
空实测面 → FR-022/023/024 落伪域 auto-sillyspec、决策落 unmapped.md。

## 影响

- 归档件永久缺 patch 留档（归档即拒收重入，事后无法 `--refreeze` 补冻）；
- 平台资产卡 patch/delta/影响模块/测试绑定全空，审计断档；
- 与 cli-cwd-coupling 坑叠加时（会话曾 8 次跑错目录），冻结窗口错位的
  概率进一步放大。

## 绕过

**（已处理后备忘）新变更不再需要手工规避**：空冻结面+声明清单未标注条目会在 flow done patch 子步被点名阻断并一次给全三处置（主仓提交/跨仓规范标注/`--accept-empty-face` 签收）；`## <注册key> 仓变更` 段头写法已可被 thin 收口对账解析（h2 段头+`### <key>` 子段+`cross-repo:` 前缀三形态均识别），跨仓对账与 repos[] patch 冻结正常触发。历史规避手段留档：

- 新变更预防：design 文件变更清单里跨仓文件必须写规范标注（推荐段头
  「## sub-grid-security 仓变更」段内写仓根相对路径），flow done 才会对
  跨仓做对账并冻 repos[] patch——本工作区所有代码都在跨仓，这是常态动作
  而非特例；
- 已归档存量：手工把 change.patch / change-patch.json 补进归档目录（平台
  assets 读侧会认），或从跨仓提交（git show d09478ec + b47d5b36）取 diff
  自制；不补也不影响变更已完成的事实，但平台资产卡 patch/模块/测试面
  持续为空。存量归档件按冻结原则不回填。

## 期望修复

（已处理注记：0/1/2 已由状态行所列 sillyspec 变更落实〔实现形态比建议更强——空面门直接阻断+签收通道，非 advisory〕；3 未做留档；原文照存供历史检索。）

0. **thin 通道指引缺失（2026-10-13 复核补充）**：跨仓段头契约的指引目前
   只存在于**厚流程**——brainstorm design 模板「跨仓变更写法」必读段
   （stages/brainstorm.js：按仓分段、段头固定 `## <repo-key> 仓变更`、段内
   仓根相对路径、禁仓名前缀/绝对路径）+ plan-postcheck 按段头对账并点名
   段头格式错误。**thin flow start 横幅（flow.js）通篇零个「跨仓/仓变更」
   字样**，只教了「## 文件变更清单」节+表格的通用格式——CLI 在 start 时
   明明读得到 local.yaml 注册仓清单（loadRegisteredRepoKeys 在 done 才读），
   却不在注册仓非空时提示跨仓写法。本工作区全部代码在跨仓、全部 UI 变更
   走 thin，等于契约对这个形态完全不可见；
1. **声明面自证提到空/非空共享位置**：空冻结面且 design 声明清单非空
   （剔除 `.sillyspec/` 前缀后）→ 至少 advisory 点名「声明了 N 个交付文件
   但冻结面为空」，建议升格为阻断（三选一：先提交后重跑 / 确认纯文档
   变更后 `--accept-empty-face` 显式签收留痕 / 清单裁剪同步 design）；
2. **跨仓声明防呆挪出非空分支 + 覆盖面**：现告警（L1631）与 planEntries
   解析、跨仓冻结整段挂在非空 else 分支内，空面短路——本变更 design 写的
   `sub-grid-security/src/...` 前缀形态本可命中告警却从未执行。应把「声明
   清单解析 + 防呆告警」提到 ownFiles 判空之前（空面更该跑——正是跨仓声明
   撞空面的高危形态）。另首段 token 匹配对合规的仓根相对路径形态
   （`src/routes/...`，首段不命中）仍有盲区：空面 + 声明文件在主仓不存在
   （无论首段是否命中注册仓）就应点名，并可对所有 local.yaml 注册仓做一次
   存在性探测提示；
3. 顺带可评估：共享主仓路径是否也补一个轻量的「窗口外同名文件交付」探测
   （worktree 已有 reflog 扫描先例）。
