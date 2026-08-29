# 决策知识 — sillyhub-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-004@v1 : CLI 边界 = 平台侧先行，sillyspec 工具同步配套（daemon 零改动兼容）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts`
最近确认：0ec935c9
理由：平台先提供端点（spec-bundle 拉取/墓碑写路径），CLI 侧删除/归档墓碑上报（X1）与 pull --spec（X2）作跨仓任务在 sillyspec 仓落地（分支 sillyspec/2026-08-29-change-delete-closure-and-spec-pull：b86a593/16c21b0/fb35dc0）。daemon 本体零改动：bundle tar 新增顶层 PLATFORM-BUNDLE.json 经 test_bundle_metadata_compat 实证 pullSpecBundle/spec_version 判定兼容（.runtime 排除规则不变）；pull/push 时机口径维持现状（lease claim 按 latest_spec_version 判定，人拉/CLI 拉均为主动快照语义）。
