---
author: WhaleFall
created_at: 2026-08-28 15:32:40
---

# 需求规格（Requirements）

## FR-01 分身派发选机唯一钉定目标工作区绑定机器

`_dispatch_worker_core` 删除 owner 自有在线机器优先分支（`_get_online_runtime(owner_id)` 抢占）；恒以目标工作区代表绑定（`resolve_representative_binding` 解析 `workspace_member_runtimes`）作为 `pinned_runtime_id`，`pinned_skip_owner_check=True`。绑定机器不在线 → 预检 422（既有），绝不静默回落 owner 机器。

**验收**：owner 在线机器未绑定目标工作区、第三方机器绑定目标工作区且在线时，lease.runtime_id == 第三方绑定机器的 runtime id（QM小程序→crrcdt-hubin 场景复刻）。

## FR-02 预检两段式 provider 解析

预检 `resolve_representative_binding` 先按 `provider = ws.default_agent or "claude"` 严格解析；严格无果再 `provider=None` 回退任意在线 binding 并打 `placement_provider_fallback` 同款 warning；两段均无果 → 422（既有文案）。

**验收**：绑定机器仅有 codex runtime 而默认 provider=claude 时仍可解析（回退）；严格命中时无回退日志。

## FR-03 双源同序全序收敛

`resolve_representative_binding`（分支1 两个 SQL 变体 + 分支2 两个 SQL 变体）与 `resolve_daemon_instance_for_workspace` 的 daemon 选择统一补全序 `ORDER BY 实例心跳 DESC, daemon_id ASC`（后者需加 daemon_instances 心跳 join），保证钉定机器与 host_fs worktree 路由机器在相同候选集上收敛同机。

**验收**：多成员多机绑定（均在线）时两解析返回同一 daemon_instance_id；心跳并列时 daemon_id 升序 tie-break 确定性。

## FR-04 backend allowed_roots 预检（仅可判定越界才拒）

钉定后建 sub_session/run 行之前：取 `DaemonInstance.allowed_roots ∪ 该 instance 名下全部 daemon_runtimes.allowed_roots` 并集；路径取 `effective_worktree_path or resolve_root_path_for_daemon(ws.root_path)`。并集中存在绝对路径根（非 `~` 前缀）且路径归一后不在任何绝对根内（边界敏感前缀包含，Windows 形态大小写不敏感、分隔符归一）→ 400 中文引导、不建 run/lease；全部根为 `~` 或并集为空 → 放行（不可判定，daemon 终检权威）。

**验收**：绝对根越界 → 400；根全为 `~` → 放行；空并集 → 放行；`/ws/root` 命中根 `/ws/root` 或 `/ws` 均放行、`/ws-other/x` 拒。

## FR-05 daemon 交互会话 cwd 守卫（白名单终检 + 拒建不存在目录）

daemon 认领 interactive lease 段（cwd 解析后、firstRunId 非空守卫后）：`execPayload.rootPath` 为非空字符串（truthy：空串/undefined/null 同走兜底）且非借用沙箱 marker 时——先 `assertWithinAllowedRoots(cwd, _effectiveAllowedRoots())` 终检，再 stat 存在性检查；任一不过 → `notifyRunResult(status=error_during_execution, is_error=true, result_summary=中文原因含 cwd 与错误码)` 后 return，**不执行 mkdir**。守卫判定抽纯函数 `checkWorkspaceBoundCwd`（新文件 interactive-cwd-guard.ts）。

**验收**：cwd 越界 → 拒（cwd_forbidden）；cwd 不存在 → 拒（cwd_not_found）且磁盘上未创建该目录；rootPath 为空 → 保留 gap-8 mkdir（daemon-client 兜底目录可建）；借用沙箱路径不受影响。

## FR-06 存量行为兼容

- 常态（owner 机器即工作区代表绑定机器）：派发结果与旧行为一致（`:283/:317/:684` 等存量用例回归通过）。
- `test_own_runtime_preferred_over_representative` 断言旧行为 → 重写为 FR-01 新语义（需求变更非测试放水）。
- batch 路径、普通 create_session、host_fs 方法、表结构、notifyRunResult 通道格式零变化。

## NFR-01 跨平台

backend 路径归一与 daemon containment 均兼容 Windows（盘符/反斜杠/大小写）与 Linux 形态；纯函数测试双形态覆盖。

## NFR-02 fail-loud 原则

所有新拒绝路径（422/400/cwd 守卫）均产生可诊断的中文错误信息；不错误配置静默降级或自动创建目录。
