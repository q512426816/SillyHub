---
plan_level: full
---

# 实现计划（Plan）

## Wave 1（并行，无依赖——四卡文件正交）
- task-01
- task-02
- task-03
- task-04

## Wave 2（依赖 Wave 1——四卡文件正交）
- task-05
- task-06
- task-07
- task-09

## Wave 3（依赖 Wave 2 槽位契约）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 纯函数库扩展 | W1 | P0 | — | FR-02/06/07 数据面, D-004/005/009 | attachment-refs.ts 增 WsRefDesc/五函数 + 单测（并集分配/三类置换/三类解析/孤儿降级） |
| task-02 | FilePreview 行号与选区右键 | W1 | P0 | — | FR-04, FR-05, D-002/006/007 | 代码分支 showLineNumbers；纯文本分支行结构 data-line；selectionLineRange + contextmenu 非空才拦截 + onAddSelectionRef |
| task-03 | FileExplorer 树右键 + 通用菜单组件 | W1 | P0 | — | FR-01 | NEW ui/floating-context-menu.tsx（看板模式）+ 行级 onContextMenu + onAddNodeRef + 用例 |
| task-04 | InputRefOverlay 类型角标 | W1 | P0 | — | FR-03, D-001 | tokenMetas props + 左上类型角标 + 悬停 tooltip 元数据 + 版式守卫用例 |
| task-05 | SessionInputBar 工作区引用接入 | W2 | P0 | task-01, task-04 | FR-02 单聊侧 | wsRefTokens 状态 + onWsRefTokensChange 受控回传 + pendingWsRefInsert 槽位消费 + 删附件联动隔离 + 用例 |
| task-06 | portal 槽位接线 | W2 | P0 | task-02, task-03 | FR-01 通道 | 两壳透传回调 + sessions-portal 组装 WsRefDesc（树快照 wid）+ pendingWsRefInsert 下发四分支 + 空门户 toast + 用例 |
| task-07 | 组装位置换接线 | W2 | P0 | task-01 | FR-06, D-008@v2 | grep substituteAttRefsForSend 重盘（2026-10-10 实测 7 处：dialog 312/392/1343、page 835/2748/3258、group 1969——group 点位由 task-08 接）后同点位串联 substituteWsRefsForSend + 用例 |
| task-09 | 历史渲染 | W2 | P0 | task-01 | FR-07 | InlineAttRefText 换 parseInlineRefs + 三类标签 + onOpenWsRef + turn-segment-views 接 FilePreviewModal(fetchDownload) + 用例 |
| task-08 | 群聊全链路接入 | W3 | P1 | task-01, task-04, task-06 | FR-08, D-008@v2 | group-chat-panel：输入区接入 + 槽位消费 + group:1969 组装位串联 + 历史渲染 + 用例 |

## 关键路径
task-03 → task-06 → task-08（入口→槽位通道→群聊，三跳最长）；task-01 → task-07 为置换数据面支线。

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 镜像高亮层背景块「严禁加 margin/padding/border——overlay 与 textarea 逐字符对齐（错位教训 2026-10-10：mx-px 每标签多 2px，多标签累积漂移），背景块只用 background+radius 零布局影响」；角标 absolute 定位不进文本流，token span 不得带 opacity/transform 等 stacking context 触发器。
- 品牌色一律 brand-* 语义阶（随 html data-theme 换肤），blue-* 阶仅限真信息蓝；阴影走主题 token；antd 组件色经 ConfigProvider token 不手写。
- 后端零改动：0 端点、0 schema、0 存储；引用为正文文本协议随消息透传（D-004）。
- 孤儿 token 原样保留（降级为纯文本语义）；历史解析失败片段原样显示。
- 未插入任何工作区引用时：输入区/预览区/发送链路零视觉与行为差异（brownfield 回退路径）。
- 组件位/文案中文；`Date.toLocaleString()` 必须显式传 `"zh-CN"`。
- 组装位以 `grep substituteAttRefsForSend` 实测现状为准（D-008@v2），task-07/task-08 落码前重盘核对。
- FilePreview 未传 onAddSelectionRef 的消费方（explorer 页）行为不变；.md/图片/PDF/二进制分支零改动。
- parseInlineRefs 三类标记正则须显式覆盖 path=""（[目录引用:wid|] 空尾段）并声明路径含 |/] 字符的处理边界（审查 requiredEvidence X-5）。
- allocateWsRefToken 的 poolTokens 是否并入正文手打【…】保守占位：对齐既有附件路径 inText 并集口径（session-input-bar.tsx:292-296 先例，审查 requiredEvidence X-1）。

## 全局验收标准
1. 相关单测全绿（attachment-refs / file-preview / file-explorer / input-ref-overlay / session-input-bar-upload / sessions-portal / group-chat-panel / attachment-ref-tag 族），仅跑本变更相关套件，全量留给 CI。
2. 三输入区（单聊/预会话/群聊）端到端：右键树插入 → 标签（角标/tooltip/退格/×）→ 发送置换 → 历史标签可点开预览。
3. 定时发送与团队直发路径 token 全部置换（无直发漏网）。
4. brownfield：未插入引用时既有行为与渲染逐字不变；本变更前历史消息渲染不变。

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-04 | FR-03 角标用例 + 版式守卫用例 |
| D-002@v1 | task-02 | .md/图片/PDF/二进制无选区入口（file-preview 用例） |
| D-003@v1 | task-01, task-07 | 置换只产路径+行号标记（attachment-refs 用例） |
| D-004@v1 | task-01, task-07, task-09 | 三类标记置换/解析用例；0 端点声明 |
| D-005@v1 | task-01, task-05 | 并集分配 ·2/免序号用例 |
| D-006@v1 | task-02 | 无选区不拦截用例 |
| D-007@v1 | task-02 | 行号渲染 + 反选/跨行选区行号正确用例 |
| D-008@v2 | task-07, task-08 | grep 重盘记录 + 7 处（含 group:1969）串联用例 |
| D-009@v1 | task-01, task-04, task-05 | 复用扩展（既有附件函数签名不动）+ 既有用例无回归 |
| D-010@v1 | （rejected 留痕） | 不新建独立库（plan 无对应任务即落实） |
| D-011@v1 | （rejected 留痕） | 不建独立 chips 通道（plan 无对应任务即落实） |
