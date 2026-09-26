---
title: thin flow 冻结面归属被「未归档旧变更的陈旧声明」抢走（change.patch 缺实现件 + 门禁 test: skipped）
date: 2026-09-25
status: 活跃（工具侧待修；本仓绕过方案已在变更内记录）
source: 2026-09-25-scan-docs-stats-caliber 收口实测（主仓多会话并行 + 存在未归档旧变更目录）
---

# 冻结面归属劫持：他侧陈旧声明吃掉本变更的实现文件

> 一句话守则：**在主仓共享工作区跑 thin flow 时，若本变更改动过某个「某个未归档旧变更曾声明过」的文件，
> `flow done` 的冻结件（change.patch）会静默丢掉那个文件的实现段**——审计件不能自证实现，
> 门禁也据此跳过模块测试。收口前务必核对 `change-patch.json` 的 `files` 表是否含全部实现件；
> 缺了就补本变更 design 的「文件变更清单」自声明（纯路径 bullet）后重冻结。

## 现象（2026-09-25-scan-docs-stats-caliber 实证）

1. `flow done` 收口后 `change-patch.json.files` 只有 7 项：`test_stats.py` + 治理文件 +
   **他侧变更的 `docs/sillyspec/thin-flow-done-gate-frictions.md`**，**缺本次实现件
   `backend/app/modules/scan_docs/service.py`**；`gate_summary` 记 `test: skipped`（只跑了 lint 档）。
2. 独立评审把它列为 P2：「冻结交付件 change.patch 缺生产代码段……冻结件不能自证本次实现」。

## 根因（可复算）

冻结面切分 = `baseline..HEAD` 提交面 → `filter(.sillyspec/ 只留本变更目录)`
→ `splitOwnVsForeignDiffFiles(cwd, change, committed, {specBase})`（`src/foreign-declared.js`），
其中 `own` 优先、否则看他侧声明集（他变更 design §6 清单 + quick guard）。

```bash
node --input-type=module -e "
const fd = await import('file:///<CLI>/src/foreign-declared.js');
console.log(JSON.stringify(fd.splitOwnVsForeignDiffFiles(process.cwd(),
  '2026-09-25-scan-docs-stats-caliber',
  ['backend/app/modules/scan_docs/service.py'], { specBase: process.cwd() + '/.sillyspec' })));"
# → {"own":[],"foreign":[{"file":"backend/app/modules/scan_docs/service.py",
#      "owners":["2026-09-21-scan-docs-ops-panel"]}]}
```

- 劫持者 `2026-09-21-scan-docs-ops-panel` 是 **4 天前、早已完成、却一直没归档**的旧变更目录
  （`.sillyspec/changes/` 下仍在场），其 design §6 声明过 scan_docs 路径；
- **thin 变更没有自己的声明集**（design 骨架无「文件变更清单」段）→ own 恒空 → 他侧声明全胜；
- 该旧声明的「活性」又被本变更自身的编辑反向喂活（文件一 dirty 就算「在途」），
  于是这个文件永久归属它、与本变更无关。

## 影响

1. 审计件（change.patch）缺实现段——「审计真相以冻结件为准」的口径失效，只能回溯 git；
2. 门禁按收窄后的文件面选模块 → `test: skipped`（本次另有模块图未登记 scan_docs 的原因叠加，
   两条都要治）；FR 发号也落伪域 `auto-*` 而非真实模块域；
3. 冻结件反向**夹带**他侧同窗口提交的交付文件（范围是 `baseline..HEAD`，他侧 commit 落在区间内）。

## 绕过（本仓已验证可用）

1. 在该变更 `design.md` 末尾加自声明段，**路径必须是纯路径 bullet**（`- backend/app/modules/scan_docs/service.py`）：
   `parseFileChangeListDetailed` 会把带反引号/尾注描述的行**整行**当路径（实测），必须干净；
2. 清掉 `flow-state.yaml` 的 `ledger`/`patch` 子步状态（工具不支持重冻结，只能让子步重跑），
   重跑 `sillyspec flow done --change <名>` → 冻结件重建（本次 9 文件 +508/-8，含实现件）；
3. 收口前核对 `change-patch.json.files`：实现件齐不齐、有没有他侧文件。

## 建议（上游修复）

1. `parseFileChangeListDetailed` 剥反引号与行内说明（`——`/`：` 之后丢弃），兼容真实写法；
2. 他侧声明加**完成度/时效判据**：变更已归档（`changes/archive/` 有同名目录）或声明超 N 天且
   其文件长期不在 dirty 集时，声明失效——现在只有「不在 dirty 集」一条，会被本变更反向喂活；
3. `flow done` 增加**自证检查**：本变更 design/契约槽声明过的文件（或 git 提交面文件）若未进
   `files` 表，显式报错/警告，而不是静默收窄；
4. 模块图未登记目录导致的 `test: skipped` 应在 `gate_summary` 里显式标记原因
   （「无测试面」vs「模块未登记」不可区分，两者后果完全不同）。

## 处置记录（2026-09-26）

四建议逐项核销：

1. **解析剥反引号/行内说明 ✅（含本日补齐）**：反引号与「路径：描述」冒号剥离此前已落
   （`normalizePath` + 列表分支坑2 修法）；「路径 ——尾注」em-dash 形态本日补齐
   （sillyspec 仓工作树 `src/change-list.js`：列表分支 `——` 剥离，同冒号口径——仅列表
   分支、前段须 looksLikePath，误伤面零）。新增 `test/change-list-dash-note.test.mjs`
   2/2 + change-list/design-facts/design-file-list-gate 回归 6/6。
2. **他侧声明时效判据 ✅**：`35567c41` B——变更目录 mtime >7 天的声明视为陈旧忽略
   （不抢活人文件），堵住「未归档旧变更陈旧声明永久归属」主劫持面。
3. **flow done 自证检查 ✅**：`35567c41` E——design 声明的文件不在冻结面时警告，
   静默收窄消除。
4. **skipped 标因 ✅**：`35567c41` C——test skipped 时实测面透传 reason 首句，
   「无测试面」与「未命中」在 gate_summary 可区分。

归档（四建议全清；「重冻结入口」留 thin-flow-done-gate-frictions 处置记录同款延后项）。
