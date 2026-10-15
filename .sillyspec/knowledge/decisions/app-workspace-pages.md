# 决策知识 — app-workspace-pages

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-thin-hide-step-timeline
锚点：未记录
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830
理由：最大风险：出身误判导致厚变更卡片被误隐藏——缓解：复用已被 thin-badge-survives-archive / thin-display-fix 两个变更钉过的既有谓词，不引入新判定逻辑。试过放弃的方案：①按「3 行同一时间戳 + stage=archive」特征过滤补种行——放弃，脆弱启发式且过滤后必空卡；②后端停止补种 steps——放弃，补种行承载归档终态投影语义（status=archived 读时覆盖依赖 latest_progress），前端隐藏是展示层正确切面。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-workspace-dead-link-fix
锚点：未记录
最近确认：b417851478119d5774b018a105ed0e2a5df813e1
理由：- 风险：指向工作区首页后若用户期望回到「上一列表页」会多一跳——但两页入口本就来自工作区详情（侧边栏/卡片），回首页即原入口，且与平台其余子页「← 工作区」约定一致；无更优既有目标。 - 放弃方案：删除返回链接（对齐组件页下线的减法思路）——否，页头返回锚是既有导航约定，删除损失导航一致性且改动面反而更大（需动 PageHeader 结构）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-assets-knowledge-popup-preview
锚点：未记录
最近确认：20290764ce262f0940bec9e02fed5338ea9c1b79
理由：- 最大风险：测试环境债——EntryCardList 的正文渲染链 CardMarkdown → MarkdownText 用 next/dynamic，jsdom 同步渲染为 null（entry-card-list.test 先例），组件测试必须 stub MarkdownText；jsdom 无 scrollIntoView，弹窗定位 effect 会抛未捕获错误拖挂测试（knowledge-page.test 先例），测试文件需按同款 beforeAll 打桩。 - 弃案 A：组件直接 `import { normalizeKnowledgeFileParam } from "@/app/.../knowledge/page"`——省一次迁移但把知识页整图（antd Tree 等）拖进变更详情页打包图，且组件反向依赖页面是反模式，弃。 - 弃案 B：弹窗内只渲染单条条目（自写解析器抽单卡）——EntryCardList 的条目解析是双端同域契约（slugifyAnchor 与 backend parser 对齐），单条抽取等于另起一套解析器，漂移风险大于收益；整文件渲染 + 锚点滚动与知识库页行为完全一致，弃。
