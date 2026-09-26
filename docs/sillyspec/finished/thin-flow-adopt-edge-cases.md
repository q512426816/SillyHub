# 薄流程（thin）adopt 收编边界两观察（活跃坑，待上游修复）

> 来源：2026-09-25-change-center-thin-flow verify 阶段实测（本机 sillyspec 3.30.0）。
> 上游仓：C:\Users\qinyi\IdeaProjects\sillyspec。修复后按惯例移 docs/sillyspec/finished/。

## 坑 1：adopt 收编后 sillyspec.db 残留 0 字节空文件，下次 flow start 误报「db 损坏」

- 现象：临时目录实验中，对含预建产物的变更跑 `flow start` 走 adopt 收编（EXIT 0）后，
  变更目录/sillyspec 运行面留下 **0 字节的 sillyspec.db 空文件**；再次 `flow start` 报
  「进度库损坏」。
- 绕过：删除该 0 字节空 db 文件后恢复正常（ProgressManager 会重建）。
- 疑似根因：adopt 路径的 ProgressManager 初始化在中途 best-effort 失败后留下空文件句柄
  （`new ProgressManager()` 建库失败不清残骸）。
- 建议：flow.js adopt 分支收尾清理空 db；或 db-engine 打开时把「文件存在且 0 字节」
  视同不存在重建。

## 坑 2：adopt「收编补件失败」ENOENT best-effort 警告噪音

- 现象：adopt 收编时打印 `⚠️ 收编补件失败（best-effort）: ENOENT ...`（redraftMissingArtifacts
  / ensureBindingSlots 对预建目录形态的路径假设），不影响收编成功（EXIT 0）。
- 绕过：可忽略；或预建目录时同时给足四件套占位。
- 建议：adopt 分支的补件函数对「目录刚建、部分工件缺父路径」场景做 mkdir -p 语义。

## 关联留档

- 上游前置修复（flow 平台参数面四缺口 + 名称白名单）已在 3.30.0 修复并留档：
  docs/sillyspec/finished/thin-flow-quick-retirement.md
- 本文件仅记录 adopt 边界两小坑，不阻塞平台侧 thin 派发（平台 writer 不走 adopt 路径——
  变更目录由 flow start 全新建，预建仅空目录放行形态）。

## 处置记录（2026-09-26）

**坑 1（0 字节 db 残留）**：现主干复现不出（临时目录 git 仓 + 预建 proposal/design 走
adopt 收编 EXIT 0，`.runtime` 无 sillyspec.db 残留，重入 flow start 恢复简报正常无
「损坏」）——3.30.0 时代形态，当前 adopt 路径已不产生该残骸。不做代码改动（无可修的
病灶），若再现实证按新坑立案。

**坑 2（收编补件 ENOENT 噪音）✅ 已修**（sillyspec 仓工作树，未提交）：复现确认根因
——`writeAtomicSync` 开 tmp 文件不保证父目录存在，adopt 收编补件时 `.runtime/` 尚未
创建 → draft-ledger 原子写 ENOENT。修复：`src/fs-atomic.js` `writeAtomicSync` 增
`mkdirSync(dir, { recursive: true })` 保位（原子写契约是「写出完整文件」，缺父目录按
mkdir -p 语义；已存在零成本，权限类失败仍如实抛错）——整类写点受益，非只 adopt 一处。
验证：同场景复跑噪音消失、补件正常（📌 收编补生成 requirements.md、tasks.md）；
flow-protocol/flow-review 25/25、原子性三套件 3/3 全绿。

归档。
