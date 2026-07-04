---
author: WhaleFall
created_at: 2026-06-25T13:52:00
---

# SillySpec 缺陷：多 project 工作区 cwd 在子目录导致状态分裂

## 现象

多 project 工作区（如 SillyHub 含 backend/frontend/daemon 子 project）下，当 shell cwd 停在子目录（如 `backend/`）时运行 `sillyspec run <stage> --done`，状态写入子目录下**误建**的 `.sillyspec/`（如 `backend/.sillyspec/.runtime/sillyspec.db`），而非项目根的权威状态源 `.sillyspec/.runtime/sillyspec.db`。

## 根因

sillyspec 解析 `.sillyspec` 位置时用 `cwd/.sillyspec` 直接拼接，未向上查找已注册的项目根（`.sillyspec/projects/*.yaml` 的 `path`）。

## 影响（实测，change 2026-06-24-username-login verify 阶段）

- 在 `backend/` cwd 运行 `sillyspec run verify --done`（运行测试 step）→ 状态写进 `backend/.sillyspec/.runtime/sillyspec.db`（65KB 污染副本）。
- 根权威 DB（274KB）的 verify ordering5 一直 pending。
- `sillyspec progress show` 输出自相矛盾（顶部「代码扫描 / 项目未命名」 vs 列表「验证确认进行中」）；step 归位错乱（Step5/6 已 `--done` 但显示 ⬜，Step1 却挂着 Step6 摘要）；`sillyspec run verify --done` 把流程推到 `project:backend` Step 2（step 编号重置）。

## 复现

```bash
cd backend  # 子 project 目录
sillyspec run verify --done --change <变更名> --output "..."   # 状态写进 backend/.sillyspec
sillyspec progress show --change <变更名>                       # 从根 DB 读，与 backend DB 不同步 → 错乱
```

## 修复建议

1. **`.sillyspec` 解析向上查找**：从 cwd 向上逐级查找含 `.sillyspec/` 的目录（或匹配 `.sillyspec/projects/*.yaml` 的注册根），用找到的项目根，而非 `cwd/.sillyspec` 拼接。
2. **写入前校验 cwd**：若 cwd 不在注册的项目根（`.sillyspec/projects/*.yaml` 的 `path`），警告或拒绝写入，提示切换到项目根。
3. **多 project 工作区**：`sillyspec` 命令应始终操作项目根的单一 `.sillyspec`；子 project（backend/frontend）只是 project 配置内的条目，不应各自建 `.sillyspec`。

## 临时规避

所有 `sillyspec` 命令必须在项目根（如 `F:\WorkNew\SillyHub`）运行，避免 cwd 在子目录。

## 相关

- 本次 change `2026-06-24-username-login` verify 阶段触发，经 `sillyspec run doctor` 诊断 + 手动清理 `backend/.sillyspec` + 根 cwd 补录 ordering5/6 修复。
- `archive/2026-06-25-2026-06-24-username-login/verify-result.md` 的「进度修复记录」章节有完整记录。
