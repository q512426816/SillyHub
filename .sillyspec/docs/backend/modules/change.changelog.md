---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — 审批动作结果通知与待办消解（变更 2026-08-29-approval-notify-push task-05）
- 四审核门（proposal_review/plan_review/human_test/archive_confirm）+ 旧版 approve/reject 末尾新增 `_notify_approval_result`（与 _maybe_notify_session 同层）：先 resolve_pending 消解同 ref 待办，再向 changes.owner_id 发 approval_result（owner None 跳过）。门中文名常量 _APPROVAL_GATE_LABELS 与前端变更中心口径一致。用例 tests/test_approval_result_notify.py。

## 2026-08-30 — 风险审查高置信缺陷修复批（quick ql-20260830-001-2e52）
- reparse 删除闭环两修（审计②③）：_detect_renames orphaned 候选排除 location='deleted' 墓碑行（防同日新建变更被 rename 错配→出生即隐藏+上行永久 409 无逆转）；删除环遇 manifest platform_deleted=True 锚点的 'active' 行降级置软删（stats.tombstoned）不物理删——防 delete_change 步骤①commit 与步骤⑤之间的半删窗口被 reparse 物理删 CASCADE 抹掉 change_events/documents/session_links（R-09 审计保护）。

## 2026-09-27 — 模块触达 doc 路径越界守卫（thin 2026-09-27-audit-followup-hardening）
- assets.py 新增 `_safe_module_doc`：模块图 `_module-map.yaml` 的 doc 值属工作区镜像内容，未归一化直拼 `docs/<project> / doc` 可越出项目 docs 根读宿主文件（读面仅 h1 首行回显，低 severity）。越界形态（POSIX 绝对含 `//` UNC、Windows 盘符含 drive-relative、反斜杠归一后判、`..` 段）整条丢弃 → 不读盘、ChangeTouchedModule.doc=None（前端不放预览 chip）、模块名回退 id；正常相对 doc 零回归。测试：test_assets 22 绿（新 traversal 用例红→绿闭环，三形态 + 正常回归）。

## 2026-10-07 — 归档留档缺件回退（thin 2026-10-07-assets-patch-scope-audit-fallback）
- assets.py 读侧回退补镜像缺口（docs/sillyspec/finished/thin-flow-done-no-scope-audit-snapshot.md）：`_read_patch_meta` 缺 change-patch.json 时回退读 scope-audit.json（totals/patchStatus/savedAt 同构直取，file_list 从 rows[].path 投影）——厚流程归档「归档留档」patch 块不再整块缺失；`_read_patch_file_diff` 缺 change.patch 回退切 scope-audit.patch（note 指名实际留档）。两份并存 change-patch.json 优先，thin 形态零变化；DTO/前端零改动。测试：test_assets 28 绿（新增 4：快照回退投影/切片回退/双缺 fail-open/并存优先级）。
- 2026-10-12-backfill-run-change-context | 动机：轮级打锚（2026-10-12-run-level-change-attribution）只对新会话生效，存量会话
- 2026-10-13-anchor-mismatch-fix | 动机：轮级打锚的「轮归开始时上下文」语义在「整个变更的生命周期发生在单轮内」时产生错配——该轮全部 sillyspec 
- 2026-10-13-change-reparse-autobind-remove | 动机：reparse 首建变更行时自动绑定工作区最近活跃会话（D-007）误伤面大——闲聊/测试会话躺着中枪（2026-
- 2026-10-13-change-owner-backfill | 变更中心负责人数据大面积缺失（342 条变更 300 条 owner_id 为空，2026-09-08 后新建全为空）：
- 2026-10-14-files-refresh-explicit-sync | 动机：文件树刷新前置同步的触发面挂在了 GET files 接口本体上——会话悬浮面板 15s 自动轮询、初始加载等非主
- 2026-10-14-change-center-lineage-tag-and-filter | 变更中心列表只给轻量出身行显示「轻量」标签，完整流程变更没有任何标签，且筛选下拉里只有「轻量变更」（走 stage=th
