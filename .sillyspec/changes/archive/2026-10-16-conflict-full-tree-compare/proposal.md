---
author: qinyi
created_at: 2026-10-16 16:55:44
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
跨多个变更的全量 spec 同步冲突，机器侧按 CLI 归因口径落盘为 `spec-sync-conflict-full-tree.json`，
而平台对比端点按单变更名去找 `spec-sync-conflict-<change>.json`——文件名对不上，平台「查看对比」
对这类行 100% 失败（502 `conflict_record_missing`）。同时该冲突行是平台注册表 open 行，只有下一次
同步全绿才自动关闭，刷新列表永不消失；失败卡文案还把原因写死为「机器可能离线或超时（504）」，
误导排查方向。现网实证见 `docs/sillyspec/conflict-compare-full-tree-label-mismatch.md`。

## 关键问题
1. **对比不可用**：平台行名（按路径归因的单变更名）与机器记录名（跨变更 → `full-tree`）口径分裂，
   对比的 RPC 永远读不到文件。
2. **行滞留无出口**：注册表 open 行的关闭条件是「下一次同步全绿」（`backend/app/modules/spec_workspace/service.py:1366-1390`），
   刷新/重试都不触发；前端没有手动关闭入口（`POST /spec-conflicts/{id}/resolve` 有接口无 UI）。
3. **文案误导**：失败卡固定输出「机器可能离线或对比读取超时（504）」（`frontend/src/components/changes/conflict-compare-modal.tsx:260-277`），
   与真实 daemon_code 无关，把「记录缺失」误报成「机器/网络问题」。

## 变更范围
- 后端：compare 编排在 `conflict_record_missing` 时以记录名 `full-tree` 兜底重取一次快照，做段边界
  路径归属校验与裁剪，只呈现所请求变更范围内的对比；响应新增来源字段（record_label/covered_changes/path_total）；
  `conflict_record_missing` 用户文案改为可行动指引。
- 前端：对比失败卡按错误码分支三态（记录缺失/未认领/离线超时）；兜底命中时展示来源提示条；
  冲突行新增「标记已处理」入口（复用既有 resolve 接口，把注册表行置 `resolved`）。
- 契约：后端响应新字段同步 `backend/openapi.json` + 前端/daemon 两份 `api-types.ts`（规则 21）。
- 原型：真码原型视图 `frontend/src/components/prototype/conflict-sync-states-view.tsx` + 编译产物。

## 不在范围内（显式清单）
- 不改裁决（保本地/取平台）链路——跨变更记录的裁决要改 CLI 记录匹配口径，另开 change（D-002）。
- 不做 daemon 侧读取改动、不新增 daemon RPC（D-001/D-011）。
- 不改 CLI（外部仓）推送负载与记录命名（D-010）。
- 不重构冲突行的渲染/归因逻辑（沿用 `registryVersionRows` 既有归因）。

## 成功标准（可验证）
- 后端单测覆盖：兜底命中（裁剪正确、字段齐、只重试一次）、兜底未命中（非本变更路径→原错误）、
  `kind=progress` 不触发兜底、首取成功不触发第二次 RPC。
- 前端单测覆盖：失败卡三分支文案与按钮差异；「标记已处理」确认流调用 resolve 接口并让行从列表消失。
- 本地相关测试与 lint/typecheck 全绿（只跑本改动相关面，不跑全量——CLAUDE.md 规则 0）。
- 部署到腾讯云生产后用现网 `2026-10-13-fire-unitadd-form-import` 行真机复验：对比可打开且仅含该变更
  的 4 个路径、来源提示正确、失败卡文案分支正确、「标记已处理」可用且行消失。
