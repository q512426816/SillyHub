---
author: qinyi
created_at: '2026-09-16 07:50:00'
scale: large
---

# 需求文档（Requirements）— 2026-09-16-platform-progress-ingest-persist

## 功能需求

- **FR-01 progress ingest 权威落库**：`POST /api/changes/{name}/progress` 接受后（分支 1「base_ts 空」与分支 3「stored ≤ base_ts」），`changes` 表行的 `current_stage` 由载荷 `changes[]` 同名条目权威覆盖；`status` 按显式映射表 `{"active": "in_progress", "in_progress": "in_progress", "archived": "archived"}` 落库。幂等：同载荷重放无状态漂移。
- **FR-02 未知枚举告警**：status 值不在映射表（且非 deleted——deleted 走既有 `_apply_cli_tombstone` 通道）→ `log.warning`，只写 `current_stage` 不写 `status` 列。
- **FR-03 乐观锁/拒收零回归**：`base_ts` 409 冲突分支与 `change_deleted` 拒收分支不落库、响应体不变；文档（D-003 单写者）/审批通道语义不变。
- **FR-04 title 文档推送重派生**：`POST /api/changes/{name}/documents` 接受后按最深阶段文档（proposal < requirements < design < tasks）H1 重派生 `changes.title`；H1 为模板文案（含 `— <key>` 后缀变体）→ 归一化回退 change_key 去日期前缀；自定义 H1 原样采用；parser `_extract_title` 同源归一化（reparse 不回翻）。
- **FR-05 MASTER 占位行清理**：parser 对缺席 MASTER.md 不再发 `exists=False` 占位行；其余标准文档补缺席行行为不变；存量 MASTER 脏行由 reparse 的 seen_keys 删除环自然清理。
- **FR-06 旧 CLI 兼容**：无 `X-SillySpec-Base-Ts` header（首推分支 1）、载荷缺 `status` 字段、载荷缺 `current_stage` 字段三种形态行为安全（缺省不覆盖对应列）。

## 非功能需求

- **NFR-01 best-effort 边界**：ingest 落库与 title 派生失败（DB 异常）仅 log.warning，不阻断上行主流程（收件箱行/占位行/owner 对齐先落为准，`_ensure_change_row`/`_sync_change_owner` 同范式）。
- **NFR-02 性能**：接受分支新增一次主键重查 + 单行 UPDATE（毫秒级），不放大「平台响应慢 → CLI 熔断」循环。
- **NFR-03 archived 终态形态**：`archived` 落库 = `status='archived'` + `current_stage='archived'` + `archived_at` 仅首填；`location` 不动（文件移动 + reparse 收敛）。

## 约束

- 不改 sillyspec 仓；不改 API 契约字段；无 schema 迁移；测试走既有 in-memory fixture 范式；错误/日志事件名点分蛇形 + 中文文案守护测试合规。
