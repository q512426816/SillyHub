# 决策知识 — backend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-001@v1 : 变更删除权限口径 = 变更 owner + 工作区所有者 + 平台管理员
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/change/router.py`
最近确认：0ec935c9
理由：DELETE /workspaces/{ws}/changes/{cid} 组合依赖——require_permission(Permission.CHANGE_ARCHIVE)（workspace_owner 角色内置、platform_admin 短路）OR change.owner_id==当前用户；owner 取当前值并接受漂移语义（owner=最新推送人），owner 为空（从未上行进度）时仅前两者可删。名称末段输入防呆 + change_events 审计兜底误删面（R-04）。

## D-002@v1 : 平台删除 = 软删隐藏 location='deleted'，不做恢复 UI
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/change/service.py`
最近确认：0ec935c9
理由：Change 行置 location='deleted' 第三区（active/archive 两 tab 显式传参天然不显示，读端 enrich 对 deleted 前置过滤）；镜像文件移 30 天备份区 + manifest platform_deleted 墓碑；写 change_events delete 审计（行保留故 FK 不级联丢审计）；不物理删不做恢复界面（未上线允许 DB 人工恢复，规则 11）。

## D-005@v1 : 删除自动收敛 = 方案 A 镜像驱动收敛（+CLI 墓碑上报增强）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/spec_workspace/service.py`
最近确认：0ec935c9
理由：平台以镜像文件树为唯一权威：apply_ops 幽灵空目录清理 → scoped reparse 定向删除（R-08 收窄：仅 scope∩磁盘确认消失可删，scope 外零动作）→ 删除环顺手清 progress 行 → platform_deleted 四通道拦截。拒 B（墓碑上行驱动——旧版 CLI 不发墓碑照旧残留、且平台删除入口仍需 A 的防复活基建）、拒 C（全量对账常态化——Windows bind mount stat 性能断崖 + 全量 reparse 93s 超时史）。误删面最小（scope 收窄 + 7 天占位保护 + 30 天备份区）；CLI 墓碑上报为收敛加速器，平台闭环不依赖。

## D-006@v1 : Design Grill 加固 — 删除环豁免 deleted 行 + 持久锚点兜底 + 落盘级拦截
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/platform_sync/service.py`
最近确认：0ec935c9
理由：B-1/B-2 修复三点：① scoped 与全量两处删除环 + _apply_parsed 更新路径均豁免 location='deleted' 行（不删不回翻，审计不 CASCADE 丢失、锚点行保活）；② _ensure_change_row 拒收双层——Change 行 location='deleted' 为主判据，行缺失时兜底探测 manifest platform_deleted 前缀（LIKE 转义 %/_，变更名含下划线常见）；③ _write_spec_root 落盘集计算阶段排除 platform_deleted 前缀路径（文件不落盘断 parser 复活链，仅挡 manifest 对齐环不够——tar 落盘在先）。附带修正：delete op 对 platform_deleted 幂等放行（仅拦 add/rename）、spec-bundle 鉴权口径 _write_auth、progress 拒收 409 用 code=change_deleted 结构化区分。
