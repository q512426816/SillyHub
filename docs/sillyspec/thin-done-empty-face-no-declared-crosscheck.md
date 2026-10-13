# thin flow done 空冻结面分支不做 design 声明面自证（声明了交付文件却空面归档零告警）

> 记录时间：2026-10-13 · 来源变更：2026-10-12-fire-ledger-form-strict（生产实证：平台工作区「消防设施器材」4e9eb05b，会话 47e2ff1a）
> 状态：活跃坑（CLI 3.32.7 实证，待工具修复）

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
   `cross-repo:<key>:` 前缀三选一）。本变更 design 承诺「改动面仅
   LedgerForm.js 单文件」但清单未按规范标注 → planEntries 无 repo 标注 →
   跨仓对账与 repos[] patch 冻结全不触发（已知坑
   design-filelist-crossrepo-prefix-silent-main 的活体复现，且 thin 通道下
   零告警——未标注路径静默按主仓对账成「计划未动」）。

蒸馏侧连锁：distill 实测面同样只看主仓（跨仓文件在主仓 git 不可见）→
空实测面 → FR-022/023/024 落伪域 auto-sillyspec、决策落 unmapped.md。

## 影响

- 归档件永久缺 patch 留档（归档即拒收重入，事后无法 `--refreeze` 补冻）；
- 平台资产卡 patch/delta/影响模块/测试绑定全空，审计断档；
- 与 cli-cwd-coupling 坑叠加时（会话曾 8 次跑错目录），冻结窗口错位的
  概率进一步放大。

## 绕过

- 新变更预防：design 文件变更清单里跨仓文件必须写规范标注（推荐段头
  「## sub-grid-security 仓变更」段内写仓根相对路径），flow done 才会对
  跨仓做对账并冻 repos[] patch——本工作区所有代码都在跨仓，这是常态动作
  而非特例；
- 已归档存量：手工把 change.patch / change-patch.json 补进归档目录（平台
  assets 读侧会认），或从跨仓提交（git show d09478ec + b47d5b36）取 diff
  自制；不补也不影响变更已完成的事实，但平台资产卡 patch/模块/测试面
  持续为空。

## 期望修复

1. **声明面自证提到空/非空共享位置**：空冻结面且 design 声明清单非空
   （剔除 `.sillyspec/` 前缀后）→ 至少 advisory 点名「声明了 N 个交付文件
   但冻结面为空」，建议升格为阻断（三选一：先提交后重跑 / 确认纯文档
   变更后 `--accept-empty-face` 显式签收留痕 / 清单裁剪同步 design）；
2. **跨仓声明防呆的覆盖面**：现有 advisory 只在「声明路径首段 token 命中
   注册仓 key/basename」时触发（`sub-grid-security/src/...` 形态）；裸仓根
   相对路径（`src/routes/.../LedgerForm.js`，首段 `src` 不命中）完全无告警。
   空面 + 声明文件在主仓不存在（无论首段是否命中注册仓）就应点名，并可
   对所有 local.yaml 注册仓做一次存在性探测提示；
3. 顺带可评估：共享主仓路径是否也补一个轻量的「窗口外同名文件交付」探测
   （worktree 已有 reflog 扫描先例）。
