---
id: task-05
title: "context_builder prompt platform-managed 分支去 .sillyspec（指示 <specroot>/docs/ 直接路径）"
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/context_builder.py
---

# task-05 — context_builder prompt platform-managed 分支去 .sillyspec（指示 <specroot>/docs/ 直接路径）

## goal

把 `context_builder.py` 中 **platform-managed 模式**（`is_platform_mode`，即 `spec_root` 非空的 daemon-client / 平台托管 workspace）scan prompt 的文档输出路径文案从 `<specroot>/.sillyspec/docs/` 改为 `<specroot>/docs/`（去掉 `.sillyspec` 包裹），与 daemon 实际扁平产出（`<specroot>/docs/...`，design §1 根因 B 实测）及 Phase 1 reader 扁平契约（task-01 `SpecPathResolver(platform_managed=True)` 各 `*_dir` 省略 `.sillyspec` 段）保持一致。覆盖 FR-04，承接 task-01。

## implementation

1. **定位 platform-managed 分支**（context_builder.py:582-608，`if is_platform_mode:` 内 `step_prompt`）：
   - `:600` 文案 `f"- 文档生成在 {host_spec_root}/.sillyspec/docs/ 目录下\n"` → 改为 `f"- 文档生成在 {host_spec_root}/docs/ 目录下\n"`（去 `.sillyspec` 段）。
2. **保留 server-local / 源码模式分支**（context_builder.py:609-637，`else:` 分支）**不动**：
   - `:628` `.sillyspec/ 目录会在源码目录下创建（由 --dir 决定）` 保留（源码目录 init 仍产 `.sillyspec/`）。
   - `:629` `{spec_root}/.sillyspec/docs/` 保留（repo-native / server-local 仍是包裹布局）。
3. **保留其他约束语**：
   - `:598` `文档生成在 {host_spec_root}/ 下，源码目录保持只读，不会创建 .sillyspec/`（platform-managed「不在源码目录创建 .sillyspec」语义，与本 task 方向一致，可保留或顺带与 :600 文案对齐——若 :600 改为扁平，:598 的「不会创建 .sillyspec」仍准确，不改）。
   - `:599` `平台模式禁止执行 sillyspec init` 保留。
   - `:809`（`render_bundle_to_claude_md` 的工具说明）`Do NOT write .sillyspec files directly — always use the CLI.` 保留（该约束对两种模式均成立，是 CLI-only 写入约束，非路径契约）。
4. **仅调路径文案**，不引入 mode 形参 / strategy 判断——该 prompt 已用 `is_platform_mode` 分流，直接改 platform-managed 分支字符串即可；不需接 task-01 的 `SpecPathResolver`（prompt 用的是 `host_spec_root` 宿主路径字符串，非 resolver 路径对象）。

## acceptance

- platform-managed scan prompt（`is_platform_mode=True`）的「文档生成在」文案指向 `{host_spec_root}/docs/`（直接路径，无 `.sillyspec` 段），与 daemon 扁平产出 + Phase 1 reader `platform_managed=True` 的 `docs_dir(p)→root/docs/p` 契约一致（FR-04）。
- server-local / 源码模式 prompt（`else` 分支）文案**零变化**：仍指示 `.sillyspec/` 在源码目录创建、`{spec_root}/.sillyspec/docs/` 产出（SC3 回归）。
- `render_bundle_to_claude_md`（:809）的 `Do NOT write .sillyspec files directly — always use the CLI.` 约束语保留不变。
- 不新增 / 删除 prompt 的其他规则（源码只读、禁止 init、AskUserQuestion 暂停、平台参数必含等全部保留）。

## verify

```
cd backend && uv run pytest tests/ -k "context_builder or scan_bundle or build_scan" -q
cd backend && uv run ruff check app/modules/agent/context_builder.py
cd backend && uv run mypy app/modules/agent/context_builder.py
```
补充用例（如无则新增）：platform-managed 分支 prompt 文本断言含 `{host_spec_root}/docs/` 且**不含** `{host_spec_root}/.sillyspec/docs/`；server-local 分支 prompt 文本断言仍含 `{spec_root}/.sillyspec/docs/`（回归守护）。若现有 prompt 测试用快照/子串匹配 `.sillyspec/docs`，需区分 mode 更新断言（禁止改测试逻辑绕过，仅对齐文案）。

## constraints

- **仅 platform-managed 分支调路径文案**；server-local / 源码模式分支（:628-629）的 `.sillyspec` 指示**不改**（FR-04 守护 + SC3 零回归）。
- 不改 prompt 的其他约束：源码只读、平台模式禁止 `sillyspec init`、命令模板参数必含、AskUserQuestion 暂停语义、`:809` CLI-only 写入约束全部保留。
- 不引入 `SpecPathResolver` / `platform_managed` 形参（prompt 走 `host_spec_root` 宿主路径字符串，与 resolver 路径对象解耦；mode 分流已由 `is_platform_mode` 完成）。
- 不触碰 allowed_paths 之外文件。
- 兼容 Windows / Linux / macOS（纯字符串文案调整，无平台分支）。
