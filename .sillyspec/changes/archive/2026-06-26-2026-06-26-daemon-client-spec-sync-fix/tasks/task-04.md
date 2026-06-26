---
id: task-04
title: "spec_workspace/validator 按 mode 走 resolver + post_scan_validator 核实 R3（可能 no-op）"
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/validator.py
  - backend/app/modules/agent/post_scan_validator.py
---

# task-04 — spec_workspace/validator 按 mode 走 resolver + post_scan_validator 核实 R3

## goal

把 `SpecValidator` 中 `root / ".sillyspec" / "projects"` 的硬编码改为走 task-01 的 `SpecPathResolver`（按 mode 解析），使 platform-managed workspace（spec_root 即 `.sillyspec` 内容根、扁平 `projects/`）能通过 `NOT_SILLYSPEC`/结构校验；同时核实 `post_scan_validator.py` 的 `source_root` vs `spec_root` 语义（R3），确认是否受 Phase 1 mode 影响。覆盖 FR-01，承接 task-01。

## implementation

1. **validator.py**（改）
   - `_check_directory_structure`（validator.py:103）、`_check_yaml_schema`（validator.py:133）、`_check_references`（validator.py:195）三处 `root / ".sillyspec" / "projects"` 统一改为经 resolver 取 `projects_dir`。
   - 因 `SpecValidator.validate(spec_root)` 当前无 mode 入参，需增 `platform_managed` 透传：`validate(self, spec_root, *, platform_managed: bool = False)`，内部构造 `resolver = SpecPathResolver(spec_root, platform_managed=platform_managed)`，三个内部方法接收 resolver 或 projects_dir（避免三处重复拼）。
   - 调用方（`spec_workspace/service.py` 等传入 spec_root 处）按 workspace strategy 推 mode：优先 `SpecPathResolver.for_spec_workspace(spec_ws)` 取 `platform_managed` 透传，或直接用工厂构造 resolver 后取 `projects_dir`。调用方若在 allowed_paths 之外，则仅在 validator 自身保留 `platform_managed` 形参（默认 False，零回归），透传由调用方负责——若调用方未改，等价 repo-native 行为，不破坏现状。
   - `_check_yaml_schema` 仍需 `component_ids` 收集逻辑、`_check_references` 仍用同一 `projects_dir`，保留 YAML schema/引用校验语义不变。
2. **post_scan_validator.py**（核实，可能 no-op）
   - 核实三处 `.sillyspec` 引用语义：
     - `:215` `_archive_and_clean_pollution` 的 `source_root / ".sillyspec"`——source_root 是**源码目录**（agent 工作区，scan 写入的 `.sillyspec` 包裹天然存在）。
     - `:254` `_check_source_pollution` 的 `source_root / ".sillyspec" / "docs"`（污染检测，预期 source_root 下**不应**有产物）。
     - `:282` `_check_output_paths` 的 `spec_root / ".sillyspec" / "docs"`（期望产物位置）。
     - `:392` `_check_local_config` 的 `source_root / ".sillyspec" / "local.yaml"`。
   - **判断**：post_scan_validator 的 `source_root` 是源码目录（与 spec_workspace 的 spec_root 不同实体），platform-managed mode 仅改 spec_root 语义，不改 source_root 的源码目录包裹语义。`_check_output_paths` 的 `spec_root` 虽是 platform-managed spec_root，但 scan agent 跑在源码目录、产物经 pollution 检测/归档后落到 spec_root——需确认 platform-managed 下 scan 产物是否仍走 `.sillyspec/docs` 包裹。
   - **结论写入 acceptance**：核实后若 source_root 仍带包裹、spec_root 在 scan 路径下仍期望 `.sillyspec/docs`（即 scan agent 产出布局未变），则 post_scan_validator **不改**（no-op），仅在 acceptance 注明核实结论与依据；若发现 platform-managed 下 `_check_output_paths` 的期望路径需扁平化，再按 mode 适配（此时 post_scan_validator 须能拿到 mode/strategy，可能需扩 `__init__` 入参）。

## acceptance

- platform-managed workspace 调 `SpecValidator.validate(spec_ws.spec_root, platform_managed=True)`：当 `projects/` 下有合法 YAML（含 `name` 或 `id`）时 `passed=True`，不再因缺 `.sillyspec` 包裹误报 structure error（消除 `WORKSPACE_NOT_SILLYSPEC` 误触发路径之一）。
- repo-native / server-local（`platform_managed=False` 默认）行为零回归：仍校验 `<root>/.sillyspec/projects/`，现有 validator 单测全绿。
- post_scan_validator 行为明确：核实结论以代码注释/acceptance 记录——
  - 若判定 no-op：post_scan_validator.py 不改，acceptance 注明「source_root 是源码目录、scan agent 产出仍带 `.sillyspec` 包裹，platform-managed mode 不适用，依据 R3」。
  - 若判定需改：`_check_output_paths`（及必要的 `_check_source_pollution` expected_path 文案）按 platform-managed mode 取扁平 `spec_root/docs`，并补 mode 透传（`PostScanValidator.__init__` 或 validate 时传入）。

### R3 核实结论（2026-06-26 执行）— 判定 no-op，`post_scan_validator.py` 不改

依据：
1. grep 证实 `PostScanValidator` 唯一生产调用方是 `backend/app/modules/daemon/run_sync/service.py:780`（`_run_post_scan_validation`），属 **batch task-runner 路径**；本变更聚焦的 daemon-client **interactive scan**（design §1 根因A `agent_sessions.14c9e08b`）不经过 PostScanValidator。
2. design §3 非目标：不改 batch daemon-client（task-runner）路径的 spec 同步语义。
3. `run_sync/service.py:746-747` 明确：PostScanValidator 结果仅写入 `lease.metadata['post_scan_validation']`，**不翻转 scan 成功语义**。故即便 batch 路径 platform-managed spec_root 下 `_check_output_paths` 的 `spec_root/.sillyspec/docs` 期望可能与扁平产出不符（潜在误报 `expected_docs_missing`），也不影响 scan-docs 可见性（读端由 task-02 `SpecPathResolver(platform_managed=True)` 修复）。
4. 改 `post_scan_validator` 须令其感知 mode/strategy，而其调用方 `run_sync/service.py:780` 传裸 spec_root，引入 mode 透传超出本 task allowed_paths 且触及非目标 batch 路径。

故 task-04 第二部分（post_scan_validator R3）= no-op，仅本结论记录；第一部分（SpecValidator mode）已 commit `601703aa`（`_projects_dir` helper + `validate(*, platform_managed)` + 三个内部方法均用 helper）。

## verify

```
cd backend && uv run pytest app/modules/spec_workspace -q
cd backend && uv run pytest tests/ -k "validator or post_scan or post_scan_validator" -q
cd backend && uv run ruff check app/modules/spec_workspace/validator.py app/modules/agent/post_scan_validator.py
cd backend && uv run mypy app/modules/spec_workspace/validator.py app/modules/agent/post_scan_validator.py
```
补充用例（如无则新增）：validator 双 mode（扁平 `projects/` vs `.sillyspec/projects/`）结构/schema/引用校验单测；post_scan_validator 既有测回归（核实 no-op 时不应有行为变化）。

## constraints

- `post_scan_validator.py` **不擅自改**：R3 待核实，先判定语义再决定改或不改，必须有依据（源码行号 + source_root/spec_root 实体区分），禁止凭 mode 流行化盲目去 `.sillyspec`。
- validator 的 `platform_managed` 默认 False，确保 server-local / repo-native 零回归（FR-01 守护）。
- 不改 validator 的 YAML schema 规则（`name`/`id` 必一、relations.target 引用完整性）与 severity 语义。
- 不触碰 allowed_paths 之外文件（调用方透传 mode 若需改 service.py，超出本 task 范围，依赖 task-03 或后续 task 处理；本 task 至少保证 validator 自身支持 mode 形参）。
- 兼容 Windows / Linux / macOS（纯 `pathlib.Path` + resolver，无平台分支）。
