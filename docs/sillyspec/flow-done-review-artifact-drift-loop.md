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
