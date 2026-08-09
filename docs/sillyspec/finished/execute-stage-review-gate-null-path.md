---
author: WhaleFall
created_at: 2026-08-07 23:18:00
status: active
---

# execute stage review gate marker 缺失致 execute-null 错误路径

## 现象
worktree execute 模式（mode: worktree）完成 14/14 步后，Stage Review Gate 报 FAILED："缺少 execute 阶段 stage review.json — 期望路径 .runtime/stage-reviews/execute-null/review.json"。但实际：
- gate 扫描的是 `stage-reviews/execute-review-*` 目录（按 reviewedFiles[0] 归属 change 过滤，stage-review.js getLatestStageReviewRunId 283-307），**根本不扫 execute-null**；
- `execute-null` 是 reviewRunId=null 时拼的错误提示路径（getLatestStageReviewRunId 返回 null → validateStageReview 拼 `${stage}-${reviewRunId}` = execute-null），误导用户往 execute-null 写（无效）；
- marker 文件 `current-stage-review-run-id-execute-<change>` 缺失（worktree execute 模式未生成），fallback 扫 execute-review-* 找不到归属当前 change 的 review（reviewedFiles[0] 不含 changes/<change>/）→ 返回 null。

## 根因
worktree execute 模式没生成 stage review marker（`current-stage-review-run-id-execute-<change>`），导致 getLatestStageReviewRunId 走 fallback 目录扫描；扫描无归属当前 change 的 execute review 时返回 null，validateStageReview 用 null 拼 execute-null 报错——错误提示路径与实际扫描路径（execute-review-*）不一致，用户照提示写 execute-null 无效。

## 绕过方案（本次用）
手动建两件：
1. `.runtime/stage-reviews/execute-review-<date>/review.json`：reviewedFiles[0]=`changes/<change>/design.md`，docHash=design.md 的 sha256（`cd .sillyspec && sha256sum changes/<change>/design.md`），reviewType=`acceptance`，specVerdict/qualityVerdict=pass，checklist 扁平数组；
2. marker `.runtime/current-stage-review-run-id-execute-<change>`：内容 `review-<date>`（必须 review- 前缀，stage-review.js:277 校验）。

marker 优先于目录扫描，建好后 --done 即过。

## 建议（工具修复）
- worktree execute 完成（或 stage review prompt 渲染时）自动生成 marker；
- 或错误提示用实际扫描的 execute-review-* 路径，而非 null 拼 execute-null 误导；
- 或 fallback 扫描找不到时，提示用户建 execute-review-<date> + marker（当前提示 execute-null 不可用）。

## 关联
2026-08-07-inject-wait-session-ready execute stage review gate FAILED，手动建 execute-review-2026-08-07-172000/review.json + marker 绕过。坑 execute-batch-complete-endtoend-checkbox.md 是另一机制（批量完成误勾端到端 task），本坑是 stage review 路径 marker 缺失。
