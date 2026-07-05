---
id: task-08
title: "[C1][SillyHub-backend] build_scan_bundle 平台模式跳过 init 步骤"
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\context_builder.py
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-08: [C1][SillyHub-backend] build_scan_bundle 平台模式跳过 init 步骤

## 修改文件
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\context_builder.py`
  - 第 422-430 行：`build_scan_bundle` 函数签名（参数：session, workspace_id, spec_root, root_path, run_id, runtime_root=None）
  - 第 465 行：`init_cmd = f"sillyspec init --dir {root_path}"`
  - 第 466-473 行：`scan_start_cmd`（启动命令）
  - 第 478-505 行：`step_prompt` 模板字符串（含"第 1 步 — 初始化"、执行流程第 1 项"执行 init 命令"）

## 覆盖来源 (design.md §4.4 / requirements.md FR-04)
- design.md §4.4 C1 init 残留：根因 `context_builder.py:465` `init_cmd = f"sillyspec init --dir {root_path}"`，root_path 是源码目录 → 平台模式在源码目录建 .sillyspec → 后续每步触发 sillyspec 源码保护"拒绝删除源码目录的 .sillyspec：检测到真实资产"。
- design.md §4.4 修复：`build_scan_bundle`（context_builder.py:465-505）平台模式（`platformOpts.specRoot` 存在）**跳过 init 步骤**——平台模式文档写 spec-root，源码目录不需要 .sillyspec。stage 模式（service.py:1006-1019 start_stage_dispatch）同理不含 init，无需改。
- requirements.md FR-04：scan 全程不再出现"拒绝删除源码目录的 .sillyspec"告警。

## 实现要求 (编号步骤)
1. **判定平台模式**：`build_scan_bundle` 入参 `spec_root`（:425）非空即视为平台模式（与 sillyspec `runStage` 的 `platformOpts.specRoot` 等价语义）。spec_root 始终由调用方传入（router.py:222 / service.py:1305 / bootstrap.py:315 都传非 None），需新增一个标志区分"需要 init"与"跳过 init"的语义。
   - **判定方案 A（推荐）**：spec_root 非 None 且不为空字符串即视为平台模式，跳过 init。
   - **判定方案 B**：新增可选参数 `skip_init: bool = False`，调用方显式传入。A 案更简单且向后兼容（现有调用方都传 spec_root，自动生效），选 A。
2. **跳过 init_cmd 生成**：将第 465 行 `init_cmd = f"sillyspec init --dir {root_path}"` 改为
   ```python
   is_platform_mode = bool(spec_root)
   init_cmd: str | None = None
   if not is_platform_mode:
       init_cmd = f"sillyspec init --dir {root_path}"
   ```
3. **step_prompt 模板调整**：第 478-505 行 `step_prompt` 模板，平台模式下：
   - 删除"**第 1 步 — 初始化（仅一次）：**"段（:481-482）
   - "第 2 步 — 启动 scan"改为"第 1 步 — 启动 scan"（:483）
   - "第 3-N 步 — 逐步推进"改为"第 2-N 步 — 逐步推进"（:485）
   - "## 执行流程"列表第 1 项"执行 init 命令"删除（:489），后续项编号顺延
   - 规则段删除"- .sillyspec/ 目录会在源码目录下创建（由 --dir 决定）"（:496），改为"- 文档生成在 spec-root 下，源码目录保持只读，不会创建 .sillyspec/"
   - 用 Python f-string 条件或拆两套模板分支（推荐拆 if/else 两段 prompt，可读性高）
4. **保持非平台模式行为不变**：spec_root 为 None/空时（理论场景，实际所有调用方都传），保留原 init 步骤——向后兼容。
5. **AgentSpecBundle allowed_paths 不变**：第 514 行 `allowed_paths=[spec_root, root_path]` 保留（root_path 仍需写入指针文件 `.sillyspec-platform.json`，见 sillyspec run.js:2368/2423）；只是不再要求源码目录建 .sillyspec/。
6. **调用方零修改**：router.py:222 / service.py:1305 / bootstrap.py:315 三处 `build_scan_bundle` 调用都传 spec_root，自动命中平台模式分支，无需改动。

## 接口定义 (函数签名/DTO)
- 函数签名（保持不变，向后兼容）：
  ```python
  async def build_scan_bundle(
      session: AsyncSession,
      workspace_id: uuid.UUID,
      spec_root: str,
      root_path: str,
      *,
      run_id: uuid.UUID,
      runtime_root: str | None = None,
  ) -> AgentSpecBundle
  ```
- 行为变更（内部）：spec_root 非空时，返回的 `AgentSpecBundle.system_prompt`（或 step_prompt 字段）**不含 init 步骤**，第 1 步直接是 `sillyspec run scan --dir ... --spec-root ... ...`。
- step_prompt 平台模式结构（参考）：
  ```
  ## 命令模板
  **第 1 步 — 启动 scan（仅一次，必须包含全部平台参数）：**
  sillyspec run scan --dir {root_path} --spec-root {spec_root} --runtime-root {runtime_root} --workspace-id {ws_id} --scan-run-id {run_id_str}

  **第 2-N 步 — 逐步推进（每次完成后执行）：**
  sillyspec run scan --done --change default --dir {root_path} --input "..." --output "..."

  ## 规则
  - --dir 必须指向源码目录 {root_path}（不是 spec_root）
  - 文档生成在 {spec_root}/ 下，源码目录保持只读，不会创建 .sillyspec/
  - ...
  ```

## 边界处理 (≥5条)
1. **非平台模式保留 init**：spec_root 为 None/空时，保留原 init_cmd + 完整 step_prompt（含 init 第 1 步）。实际所有调用方都传 spec_root，但保留此路径避免回归。
2. **platformOpts 为空（本地）**：本地场景用户用 `sillyspec init` + `sillyspec run scan` 手动操作，不走 build_scan_bundle，本任务不影响。
3. **build_scan_bundle 调用点**：三处调用（router.py:222 start_scan_dispatch API / service.py:1305 start_scan_dispatch service / bootstrap.py:315 workspace 初始化）均传 spec_root——全部自动命中平台模式分支。bootstrap.py 场景（workspace 初始化时主动 scan）同样需要跳过 init。
4. **step_prompt 编号顺延**：删除 init 第 1 步后，后续编号必须连续（1→启动，2→推进，3-N→重复），避免 agent LLM 误解指令顺序。
5. **源码目录已有 .sillyspec 时不影响**：若用户在 root_path 已手动建过 .sillyspec（含真实资产），sillyspec 源码保护会触发"拒绝删除"——本任务通过**不再要求 init**避免新增 .sillyspec，但对**已存在**的不主动清理（sillyspec 自身保护逻辑负责）。如已有残留，用户需手动删除或 SillyHub 在 workspace 注册时清理（非本任务范围）。
6. **测试 fixture 同步**：`backend/tests/modules/agent/test_context_builder.py` 现有用例（test_build_scan_bundle_prompt_contains_full_scan_command 等 :202-230）断言 prompt 含 init_cmd，需更新断言为"不含 init"（平台模式默认），或新增 test_build_scan_bundle_skips_init_in_platform_mode 用例。
7. **platform_metadata 不变**：第 519-526 行 platform_metadata 字段（mode/root_path/spec_root/runtime_root/scan_run_id）保留，daemon 据此构造 sillyspec 命令时也跳过 init。

## 非目标
- 不改 `start_scan_dispatch` service（service.py:1004-1320）的其他逻辑（lease/SessionManager/AgentRun 创建）。
- 不改 `start_stage_dispatch`（service.py:1006-1019）——stage 模式本就不含 init。
- 不改 `AgentSpecBundle` 数据类（model.py）字段。
- 不主动清理源码目录已存在的 .sillyspec（sillyspec 源码保护负责）。
- 不改 daemon 端 SessionManager（daemon 只是转发 prompt）。
- 不修改 `router.py:222` 调用点的参数（保持 spec_root 传入）。

## TDD 步骤
1. **Red**：在 `backend/tests/modules/agent/test_context_builder.py` 新增用例 `test_build_scan_bundle_skips_init_in_platform_mode`：
   ```python
   bundle = await build_scan_bundle(mock_session, ws_id, spec_root="/data/spec-ws/x", root_path="/src/myaaa", run_id=...)
   assert "sillyspec init" not in bundle.system_prompt  # 或 step_prompt 字段
   assert "第 1 步 — 启动 scan" in bundle.system_prompt
   assert ".sillyspec/ 目录会在源码目录下创建" not in bundle.system_prompt
   ```
2. **Green**：按"实现要求"步骤 2-3 修改 context_builder.py。
3. **Red**：更新现有 `test_build_scan_bundle_prompt_contains_full_scan_command`（:202）等用例：spec_root 非空时不再断言含 init_cmd；或拆为两个用例（platform_mode / non_platform_mode）。
4. **Green**：跑 `cd backend && pytest tests/modules/agent/test_context_builder.py -v` 全过。
5. **Red**：补 `test_build_scan_bundle_non_platform_keeps_init`（spec_root=None 时保留 init）——确保向后兼容路径。
6. **Green**：非平台分支未动，测试通过。
7. **类型检查**：`cd backend && mypy app/modules/agent/context_builder.py` 无新错（init_cmd 类型 `str | None`）。
8. **集成**：本地启动 backend，对 myaaa workspace 触发 start_scan_dispatch（或 bootstrap），抓 step_prompt 日志确认无 init 字样；后续 done 推进全程无"拒绝删除源码目录的 .sillyspec"。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| 平台模式 scan prompt 无 init 步骤 | step_prompt 不含 `sillyspec init` 字样 | test_build_scan_bundle_skips_init_in_platform_mode |
| 第 1 步直接是 scan 启动命令 | "第 1 步 — 启动 scan" 存在 | 单测断言 |
| 全程无"拒绝删除源码目录的 .sillyspec：检测到真实资产" | agent-run 日志无此告警 | 集成：对 myaaa 跑完整 scan，grep 日志 |
| 非平台模式保留 init（向后兼容） | spec_root=None 时 step_prompt 含 init_cmd | test_build_scan_bundle_non_platform_keeps_init |
| 编号连续无跳跃 | 第 1→2→3-N 步编号无空缺 | 人工读 prompt |
| 调用方零修改 | router.py / service.py / bootstrap.py 三处 build_scan_bundle 调用参数未改 | git diff 确认 |
| 现有测试不回归 | test_context_builder.py 全套通过（更新断言后） | pytest |
| mypy 无新错 | context_builder.py 类型检查通过 | mypy |
