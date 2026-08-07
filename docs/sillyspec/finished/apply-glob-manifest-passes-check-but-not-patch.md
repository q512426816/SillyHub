---
author: qinyi
created_at: 2026-08-07 09:50:00
stage: apply
severity: high
status: active
---

# apply：glob 覆盖的文件过 manifest 校验但进不了 patch（静默丢失）

> 变更 `2026-08-06-public-mcp-server` verify 阶段实测踩到（2026-08-07）。

## 症状

`design.md §6` 文件清单用 glob（如 `backend/app/modules/mcp_gateway/tests/test_*.py`）或多路径单 cell（如 `frontend/src/lib/api-types.ts + backend/openapi.json`）覆盖一组文件时：

- **`--check-only` / manifest 校验（Gate1）PASS**——`classifyAllowListViolations` 用 `pathMatches`（glob/前缀容差），glob 能匹配具体文件，校验放行。
- **真实 apply 报告显示这些文件"已应用"**——CLI 列 `changedFiles`（git diff 检测到的全部变更），含 glob 覆盖的文件，给人"已落地"的错觉。
- **但这些文件实际没进 patch、没落盘**——`applyWorktree` 的 `patchFiles = [...allowSet].filter(f => changedFiles.includes(f))`（worktree-apply.js:305-307）用 **字面精确匹配 `Array.includes`**，glob 字符串不在 `changedFiles` 里 → 被过滤出 `patchFiles` → patch 不含这些文件 → 主工作区没有它们。

## 实测证据

本次 apply 后 `backend/app/modules/mcp_gateway/tests/` 只有 `__init__.py`（我在 §6 显式列了），**7 个测试文件**（test_auth/model/router/service/sse/tools_new/webhook，§6 只用 `test_*.py` glob 覆盖）**全部没落盘**，apply 报告却把它们列在"已应用 37 个文件"里。靠 apply 前打的 tag `pre-apply-...` `git show` 逐个恢复。

文件清单：`worktree-apply.js` `resolveApplyAllowSet`（§6 ∪ task allowed_paths）、`classifyAllowListViolations`（pathMatches）、patchFiles 的 `changedFiles.includes`（字面）——**check 与 patch 两处口径不一致**。

## 影响

- 高：apply 报"成功应用 N 文件"但部分文件静默丢失，工作区实际不完整。若不逐文件核对，后续跑测试/构建会报"file not found"才暴露，或更糟——漏文件混进 commit。
- 本次若非跑 `pytest app/modules/mcp_gateway` 报 "no tests collected" + 手查 `ls`，不会发现。

## 期望修复（sillyspec 工具侧）

`patchFiles` 的过滤应与 `classifyAllowListViolations` 同口径——用 `pathMatches`（glob/前缀容差）而非字面 `includes`。即：`patchFiles = changedFiles.filter(f => allowSet.some(ap => pathMatches(f, ap)))`（以 `changedFiles` 为基，按容差匹配圈定），而不是以 allowSet 字面项为基过滤。这样 glob/多路径 cell 覆盖的文件都能进 patch。

## 临时绕过（用户侧）

`design.md §6` 清单**不写 glob / 不写多路径单 cell**，每个真实交付文件**单独一行显式列**（操作列写新增/修改，路径列单文件）。本次 verify 已照此补登 §6（见 `2026-08-06-public-mcp-server/design.md` §6 verify 补登注释）。

## 关联

- check/patch 口径漂移同类坑：`index-staged-cross-change-contamination.md`（index 与工作区口径）。
- 本次恢复用 tag：`pre-apply-2026-08-06-public-mcp-server`（apply 前对 worktree HEAD 打 tag 是良好安全网，强烈建议 apply 流程默认打）。
