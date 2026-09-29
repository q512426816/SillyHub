# 视觉证据（Visual Evidence）— 2026-09-29-issue-row-grid-misalign

## A. 基准（修复前，生产实测复现）

- 用户 DOM 级实证（钉钉贴元素）：列表 desc span（basis-full min-w-0 truncate）× step-sub-row 重叠
- 生产复现：crrcdt.ppdmq.top sillyspec 工作区归档 tab，unclear-req-to-brainstorm 行（Playwright）
  - desc 包围盒 right **1507** × step-sub-row left **1083** → 交集 true
  - 关键：右列容器盒 left 1519 而其内容画到 1083——justify-end + 轨道过窄时内容向左溢出自身容器盒（此前多轮扫描量容器盒故漏检）

## B. 机理 A/B（静态对照，grid-repro.html 本目录，1440×900）

| 结构 | desc.right | step-sub-row.left | 交集 | 右列容器盒 left |
|---|---|---|---|---|
| 无占位（3 子元素，现状） | 1286 | 961 | **true** | 1298（内容左溢 337px 出盒） |
| 空占位（4 子元素，修复后） | 899 | 911 | **false** | 911（内容贴盒起排） |

## C. jsdom 回归锁定

- primer-structures.test.tsx 追加用例：leading 缺席渲染 aria-hidden 空占位、行恒 4 子元素（带 leading 同为 4）；13/13 绿
- 消费方回归：changes 列表页 39/39 绿；tsc 0 错

## D. 部署后原生复测

- （部署后填写）

## 降级裁决

无视觉降级——空占位 div 无内容宽≈0、轨道宽 0、视觉零位移；带 leading 调用子元素数不变轨道不变。
