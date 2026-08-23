---
id: task-01
title: 'backend-scan-strategy-gate'
title_zh: 'backend build_scan_bundle strategy 三分支模板 + 工具提示中性化 + 三策略单测'
author: qinyi
created_at: 2026-08-23 21:40:00
priority: P0
depends_on: []
blocks: []
repo: main
base_commit: 72f153fb
requirement_ids: [FR-1, FR-2, FR-5]
decision_ids: [D-001, D-002, D-004]
allowed_paths:
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/agent/tests/test_context_builder.py
goal: >
  消除 scan 注入与 stage 派发（service.py:1358）的策略门禁不对称——repo-native 的
  scan prompt 不再携带平台参数与 init 步骤，agent 本地执行 CLI 处于本地模式。
implementation:
  - context_builder.py build_scan_bundle（:354）增读 SpecWorkspace.strategy：SpecWorkspaceService(self._session).get(workspace_id)（与 service.py:1355-1357 scan dispatch 同款读法），读取失败/行缺失回退 platform-managed
  - 三分支模板：platform-managed（含回退）/repo-mirrored 维持现有 is_platform_mode 平台模板逐字节不变（scan_start_cmd 全平台参数、无 init、扁平布局文案）；repo-native 生成本地模板——scan_start_cmd = `sillyspec run scan --dir "<root_path>"`、无 init_cmd、规则区改写（产物落源码 .sillyspec/、CLI 经 local.yaml 凭据自动同步平台无需手动操作、AskUserQuestion 门禁与逐步 done 规则沿用）
  - render_bundle_to_claude_md（:568）sillyspec 工具提示（:655）去 --spec-root 硬编码，改中性："按会话 prompt 模板的参数执行 scan；未给平台参数时不自行添加"
  - test_context_builder.py 增补：mock SpecWorkspaceService.get 返回三策略各一例——repo-native 断言 prompt 不含 --spec-root/--runtime-root/--workspace-id/--scan-run-id、不含 init 步骤、含本地产物文案；platform-managed 与 repo-mirrored 先固化改前快照再断言逐字节一致；读取异常回退 platform-managed 断言；三策略下 bundle.spec_root / platform_metadata.spec_root 双轨字段不变断言
acceptance:
  - repo-native 的 bundle.step_prompt 零平台参数、无 init 步骤（D-001@v1/FR-1）
  - platform-managed/repo-mirrored prompt 与改前逐字节一致（D-002@v1/FR-5）
  - 工具提示无 --spec-root 硬编码（FR-2）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_context_builder.py -q 全绿
constraints:
  - 不改 bundle.spec_root/platform_metadata.spec_root 双轨语义（design 背景约束）
  - 不改 service.py:1358 stage 门禁（D-004@v1）
  - 面向用户的报错文案遵循中文 L10n 守护（CONVENTIONS 7）
---

# task-01 补充说明
主仓任务：进主仓 worktree 执行（execute 常规链路）。render_bundle_to_claude_md 工具提示改动与模板分支同 PR 落地。
