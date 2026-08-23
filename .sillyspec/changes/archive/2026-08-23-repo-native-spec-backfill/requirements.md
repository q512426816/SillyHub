---
author: qinyi
created_at: 2026-08-23 21:25:00
---

# 需求（Requirements）— 修复 repo-native spec 回灌断链

## 功能需求

- **FR-1（backend scan 门禁）**：`build_scan_bundle` 按 SpecWorkspace.strategy 三分支生成 scan 执行指令——platform-managed（含读取回退）/repo-mirrored 维持现有平台模板（`--spec-root/--runtime-root/--workspace-id/--scan-run-id` 全参数、无 init）；repo-native 生成本地模板（`sillyspec run scan --dir "<root_path>"`，零平台参数、无 init，规则文案声明产物落源码 `.sillyspec/` 且 CLI 自动同步平台）。（D-001@v1、D-002@v1）
- **FR-2（工具提示中性化）**：`render_bundle_to_claude_md` 的 sillyspec 工具提示不再硬编码 `--spec-root <spec_root>`，改为"按会话 prompt 模板参数执行，未给平台参数时不自行添加"。（D-001@v1）
- **FR-3（CLI 自指判定）**：新增 `isSelfReferentialSpecRoot(cwd, specRoot)`——双方 realpath 后相等为 true，任一路径不存在/异常为 false；`isPlatformMode(platformOpts, cwd)` 在既有 `(specRoot||runtimeRoot)` 判定上附加非自指条件，替换 `shared.js` 四处裸判定。（D-001@v1）
- **FR-4（指针生命周期免疫）**：指针恢复遇自指 specRoot 忽略指针走本地模式并 warn；`writePlatformPointer` 两调用点（command.js:364 / init.js:423 的 isExternalSpec）过自指检查，自指不落盘；接管声明 fail-closed 分支对自指 `decl.specRoot` 降级为 warn 继续（disconnect 三清语义不变）；doctor 增 repo-native 断链画像告警（自指指针/陈旧声明/local.yaml platform 段缺失）。（D-001@v1）
- **FR-5（回归不变）**：platform-managed / repo-mirrored 的 scan bundle prompt 与现状逐字节一致；本地外部目录用法（`--spec-dir` 指真实外部目录、worktree 副本漂移守卫）行为不变。（D-002@v1）
- **FR-6（发版）**：工具仓 version 3.27.2 → 3.27.3，全局重装后 `sillyspec --version` 显示 3.27.3 且自指场景冒烟通过。

## 验收口径

- repo-native 本地会话端到端：变更产出（四件套/进度）出现在平台变更中心。
- 既有 repo-native 平台会话链路（junction + 会话结束整树回灌）不回归。

## 决策引用

全部当前版本决策已被需求覆盖：D-001@v1（FR-1/2/3/4/6）、D-002@v1（FR-1/5）、D-003@v1（非目标约束——daemon 零改动进文件清单核对）、D-004@v1（FR-1 中 repo-mirrored 模板维持的依据）。无未覆盖决策，无剩余风险项。
