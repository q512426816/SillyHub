---
author: flow-machine-draft
created_at: 2026-11-02T03:15:10.152Z
---
# 决策记录（Decisions）— 2026-11-02-scan-docs-unbound-view

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：无绑定且该工作区从未被任何成员的 daemon 同步过 → 服务端镜像不存在，reparse 回 DOCS_DIR_MISSING 警告 + 空列表。展示为既有空态 + warnings 横幅（既有渲染面），可接受——本来也无数据可看；不为此加特殊分支。 - 放弃方案①：后端为无绑定用户提供共享 daemon 绑定（把「借用」语义扩到读面）——牵动 runtime 权限模型，改动面大且不为「看存量数据」所需，放弃。 - 放弃方案②：不动 DaemonRequiredNotice、在 scan-docs 页内新写一个降级横幅组件——配置入口与引导展开逻辑得复制一遍，两处漂移风险，放弃（选 variant 复用）。
