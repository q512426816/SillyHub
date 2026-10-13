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

实现代码为何不在窗口内（按可能性排序，服务器侧需核实）：

1. **baseline 前置提交（redo 形态）**：会话名 `claude-xiaofang-redo`——此前
   轮次已把 LedgerForm.js 提交掉，本次 flow start 的 baseline_commit 落在
   该提交之后，baseline..HEAD 天然看不到实现；
2. **提交不在 HEAD 祖先链**：孤儿提交守卫（FR-02 scanOrphanFace）只覆盖
   会话专属 worktree 路径；共享主仓跑 flow done 不做 reflog 扫描；
3. **代码在嵌套/忽略位置**：LedgerForm.js 所在目录是嵌套 git 仓或被
   .gitignore，root 仓的 diff/status 均不可见。

## 影响

- 归档件永久缺 patch 留档（归档即拒收重入，事后无法 `--refreeze` 补冻）；
- 平台资产卡 patch/delta/影响模块/测试绑定全空，审计断档；
- 与 cli-cwd-coupling 坑叠加时（会话曾 8 次跑错目录），冻结窗口错位的
  概率进一步放大。

## 绕过

收口前人工核对一行：design 文件变更清单里的交付文件是否已提交且在
`git diff --name-only <baseline>..HEAD` 输出里。若无，先提交（信息尾缀带
变更名）再跑 `flow done`。已归档的存量只能手工补 change.patch /
change-patch.json 进归档目录（平台 assets 读侧会认），或接受缺口。

## 期望修复

把 design 声明面自证从非空分支提到 patch 子步空/非空共享位置：空冻结面且
design 声明清单非空（剔除 `.sillyspec/` 前缀后）→ 至少 advisory 点名
「声明了 N 个交付文件但冻结面为空」，建议升格为阻断（三选一：先提交后重跑 /
确认纯文档变更后 `--accept-empty-face` 显式签收留痕 / 清单裁剪同步 design）。
顺带可评估：共享主仓路径是否也补一个轻量的「窗口外同名文件交付」探测
（worktree 已有 reflog 扫描先例）。
