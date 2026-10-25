# flow done：评审产物提交 → 审计时点漂移 → 反复重评的循环

- 首次踩到：2026-10-23（2026-10-23-session-first-load-ux）
- 状态：活跃坑（工具未修）

## 现象

`flow done` 走到 review 子步后，按任务书产出 `review.json` 并提交。再次重跑 `flow done` 时被拦：

```
⚠️ 审计时点漂移：patch 冻结（<sha>）后另有 N 个本变更交付提交（含 chore(sillyspec): ... review.json ...）
   旧 review.json 已隔离为 review.json.superseded-<ts>（评审结论对着旧冻结面）——重新执行评审任务书后再收口
```

即：**`review.json`（或其他治理件）一旦提交，HEAD 前移，patch 冻结面就被判定落后，评审结论作废并要求重评**；重评后再提交新 review.json 又前移……形成循环。实测连续 3 轮都在该循环里。

同一 loop 还伴随：每次被隔离都会生成 `review.json.superseded-<ts>`，归档目录里堆积多份。

## 绕过（已验证）

1. **评审产物不提交**：把 `review.json` 直接留在工作区（不 `git add`/`commit`），立即跑 `flow done`。
   CLI 能读到未跟踪的 review.json 并据其收口；`reviewedAgainst` 写当前 HEAD 即可。
2. 归档完成后，CLI 会给出归档提交的精确 pathspec（其中已包含 `review.json`）——**随归档一次性入库**，此时不再触发漂移。
3. 中途若已经提交过、被隔离：不要再补提交；直接按当前 HEAD 重写 review.json（工作区态）→ 跑 `flow done`。

## 相关第二个坑：复审子代理不落盘 / 重建已归档目录

- 给评审子代理发「复审并更新 review.json」的消息后，前两次它只在对话里汇报，**没有写文件**（`review.json` 不存在或被隔离后未重建）。
- 归档完成后子代理才落盘，且会**按旧路径重建 `.sillyspec/changes/<change>/` 目录**，留下游离目录（归档目录之外）。
- 处置：`ls` 确认 `reviewedAgainst` 与 `reviewedAt` 是否真的更新；未更新则主会话按检查单代行复核，reviewer 如实标注 `inline-self（...降级留痕）`。子代理迟到落盘的版本可移入 `archive/<change>/review.<轮次>-subagent.json` 作为补充证据并提交。

## 建议工具侧修复

- `review.json`、`requirements/design` 之外的治理件提交不应触发「审计时点漂移」重评（当前区分不出治理件与交付件）。
- 归档完成后，CLI 应拒绝向旧 change 路径写入（子代理重建目录应报错而非静默创建）。

## 处置记录（2026-10-24 定时收口：循环根因修复，关闭归档）

- **根因锐化（比坑文推断深一层）**：治理件保留路径 2026-10-10 起已存在（detectPatchDrift
  `governanceOnly` + 未触承诺面 → review.json 保留不隔离，flow.js 漂移分支），纯治理件提交
  本不触发重评。坑内三连循环的真实机制是**两保留路径的复合盲区**：①reviewAnchoredToHead
  要求 reviewedAgainst==当前 HEAD——复审锚与 HEAD 之间隔着 review.json 自身的提交即恒 false；
  ②governanceOnly 聚合整个冻结窗——窗口内更早的「复审前修复提交」（复审 reviewedAgainst 已
  覆盖）把 ownFiles 拖进交付文件恒 false → 隔离重评 → 重评再提交 review.json 又前移 → 循环。
- **已修**（sillyspec 仓）：flow-parity.js 新增 `deliveryFaceAnchoredAfter({cwd, change,
  anchorSha})`——把「复审已覆盖」的度量单位从冻结窗换成锚点（锚后 own 提交只碰 .sillyspec/**
  且未触 requirements/design → 交付面自锚点起未变，结论有效）；flow.js 漂移分支接线为第三
  保留路径（anchored → governanceOnly → **交付面锚定** → 隔离），fail-safe：锚空/非祖先
  （rebase 重写）/git 失败 → 隔离（宁可多评）。
- **第二缺陷（子代理重建已归档目录）**：CLI 无法拦截裸 fs 写——评审任务书（renderReviewerTaskbook）
  补「写入纪律」行：review.json 只写 changeDir 指定路径、目录不存在=已归档即停止报告勿重建、
  评审产物保持工作区未提交态随归档一次性入库（先行提交会触发漂移判定——坑内绕过①的正式化）。
- **测试**：flowdone-disposition-drift.test.mjs 新增 ⑥（四形态：锚后仅治理件提交 ok /
  锚后交付提交拦 / 触承诺面拦 / 非祖先与空锚 fail-safe）7/7 绿；既有 e2e ②（漂移隔离链）
  ④⑤（缺件重冻+锚定保留）零回归。superseded 堆积随循环消除自然止增。
- 处置结论：循环根因修复+纪律面教学，本文件移入 finished/（若生产再现实测新形态另登记）。
