# 决策记录 — 2026-10-28-change-detail-side-assets-scroll

## D-001 侧栏两组区块整组删除（含取数），不隐藏不保留请求
**选定**：删 MetaPanelSection + 删 getScopeAudit / getChangeAssets 两 query + 删 auditCounts / assetCounts 派生计算与相关 import。
**落选**：CSS 隐藏（display:none）——白耗两个请求；「保留取数给其它消费方」——产出 tab 的资产卡有**自己的** queryKey（同 key 命中缓存），侧栏删取数不影响它。
**依据**：用户裁决「去掉这些信息展示」；明细入口已由「文件与对账」「产出」专属 tab 承接。

## D-02 限高滚动回归，推翻 2026-10-15-change-detail-redesign FR-06/D-001 自然高度口径
**选定**：六组卡片统一 `GROUP_CARD_CLS`（max-h-64 flex 容器）+ `GROUP_BODY_CLS`（滚动区）常量对；高度 256px 复用该变更改造前的历史值。
**理由**：用户裁决「设置个高度，超出隐藏显示滚动条」——条目多时自然高度把页面拉得过长。旧契约用例（「分组自然高度：不再使用固定高度」）按新契约改写（断言反向：限高在场 + 滚动容器在场 + toggle 在滚动区外），属设计决策变更后的契约重写，非改测试凑通过。
**历史裁决链**：2026-10-15 由「固定高度+内滚」改「自然高度+5行」的理由是「多个内滚小窗是乱的主要来源」；本次用户实测后裁决回滚——两轮裁决矛盾时以最新用户裁决为准，本条留档供后续复潮时对照。

## D-03 GroupToggle 钉在卡片底部（滚动区外）
**选定**：六组的「展开全部/收起」按钮移到滚动容器外、卡片层直接子级。
**理由**：按钮在滚动区内会被滚走（用户须先滚到底才能展开）；`self-start shrink-0` 原有样式已保证不占满行。audit 组的跨仓子组 toggle（unit=个文件）保留在滚动区内——它是跨仓清单的局部控件，与清单同滚动语义正确。

## D-04 audit（归档留档）组滚动区含跨仓区 + 文件清单整体
**选定**：标题行 + 统计行（patch/delta 计数）shrink-0 钉顶，跨仓冻结面与文件清单一并进滚动区。
**落选**：文件清单区独立第二滚动容器——256px 内双滚动条体验更差。

## D-05 既有 2 条 eslint no-unused-vars warning 不修
`change-assets-card.tsx:1006` KnowledgePreviewBody 的 useEffect 依赖参数 warning 为存量债（stash 验证本次改动前已存在），与本变更无关不顺手扩面（KnowledgePreviewBody 未触及）。
