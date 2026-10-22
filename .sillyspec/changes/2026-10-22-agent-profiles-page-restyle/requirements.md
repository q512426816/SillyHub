---
author: flow-machine-draft
created_at: 2026-10-22T05:23:58.762Z
---
# 需求规格（Requirements）— 2026-10-22-agent-profiles-page-restyle

## 功能需求

### FR-01: 页头对齐原型：品牌◆图标+标题+副标题，右侧统计胶囊（共 N 个档案·默认 M）+新建主按钮

- 列表页头必须呈现品牌◆图标块（brand token 配色）+ 主标题「智能体档案」+ 原副标题文案（逐字不变）；右侧必须显示统计胶囊「共 N 个档案 · 默认 M」（N=当前可见档案数、M=用户默认数）与「+ 新建档案」主按钮。PageHeader 共享组件以**可选 icon prop** 扩展（向后兼容，缺省不渲染图标），禁止为单页复制私有页头组件。

#### 场景：打开列表页

- Given：/agent-profiles 加载完成（4 档在池、1 个用户默认）
- When：页头渲染
- Then：图标+标题+副标题在左，统计胶囊显示 共 4 个档案 · 默认 1，新建按钮在右

### FR-02: 工具栏收拢成一张卡：搜索+工作区/可见范围/供应商三筛选+匹配计数同栏（文本仍回车触发、选择型即查，行为不变）

- 搜索框与三筛选下拉必须收拢进同一张卡片容器（圆角+边框+阴影）；交互行为必须不变：文本搜索按回车触发（不每键查）、选择型筛选 onChange 即查、计数文案保持「共 N 个档案」（N=筛选后数量，兼容既有断言）；scopedToWorkspace=true 时仍隐藏工作区筛选。

#### 场景：工具栏行为回归

- Given：3 档在池
- When：搜索「代码」回车（2 档命中）→ 清空回车
- Then：计数 共 2 个档案 → 共 3 个档案；无每键查询

### FR-03: 卡片墙 2 列；用户默认档案品牌描边+光晕+★默认胶囊；系统预置紧凑整卡（虚线降调、提示词区显「未设置系统提示词，按引擎默认人设执行」、技能区显「按引擎默认能力执行」、只读，空白压至约 1/3）

- 网格必须按屏宽自适应列数（D-001@v2，2026-10-22 断点②用户反馈修订：固定 2 列在 2K 屏过宽拉长——`repeat(auto-fill, minmax(380px, 1fr))`，宽屏 ≥3 列、常规 2 列、窄屏 1 列）；is_user_default 档案卡必须呈品牌描边+外圈光晕（brand token）+「★ 默认」品牌胶囊；系统预置卡必须为紧凑整卡形态：虚线边框降调、提示词区显「（未设置系统提示词，按引擎默认人设执行）」、技能区显「按引擎默认能力执行」、底部「只读」，且无操作按钮、无可见范围 Tag、头像显 ★（既有语义保留）；紧凑卡空白（占位区高度/内边距）必须压至常规卡的约 1/3。

#### 场景：默认档案与系统预置

- Given：极速变更（is_user_default）+ Claude Code 默认（is_system_default）
- When：卡片墙渲染
- Then：前者品牌光晕+★默认胶囊；后者虚线紧凑卡、两条提示文案与只读、无编辑/复制/删除

### FR-04: 提示词改左竖线引用式排版（去灰底块）；技能芯片等宽字体超 4 项收 +N；无技能自定义卡显「无技能（不挂载）」占位

- 提示词摘要必须改为左竖线引用式排版（去灰底块），空提示词自定义卡仍显「（未设置系统提示词）」（文案逐字不变）；技能芯片必须等宽字体，超过 4 项时收敛为 4 项 +「+N」；无技能自定义卡必须显「无技能（不挂载）」占位行；mcp_refs 芯片与技能芯片同渲染区（既有）。

#### 场景：芯片截断与占位

- Given：某自定义卡 6 技能、另一卡 0 技能
- When：渲染
- Then：前者显 4 芯片+「+2」；后者显「无技能（不挂载）」

### FR-05: 卡脚操作降躁：常态灰色、悬停提亮（含设/取消默认、编辑、复制、删除），行为不变

- 卡脚操作按钮必须常态灰色（muted）悬停提亮（brand/危险色），按钮文案与点击行为（设/取消默认、编辑、复制、删除 + stopPropagation 不触发预览）必须与现版完全一致。

#### 场景：操作回归

- Given：常规档案卡
- When：分别点击 设为默认/编辑/复制/删除
- Then：回调触发且不冒泡到卡片预览（既有用例逐条通过）

### FR-06: 无硬编码 hex，颜色走 brand/语义 token，三主题可切换

- 新增样式必须全部使用 brand-*/语义 token 或 tailwind 任意值引用 CSS 变量，禁止新增硬编码 hex（供应商头像渐变沿用既有 tailwind 渐变 token 类）；三主题切换下页头/光晕/胶囊/卡片配色必须正确跟随。

#### 场景：三主题切换

- Given：依次切换 ai-native / blue / dark
- When：打开列表页
- Then：图标/光晕/主按钮随主题换色，无残留错配

### FR-07: 既有行为回归：搜索/筛选逻辑、点击卡片预览、删除/复制/默认切换路径、空态不变

- 重构必须保持：搜索/三筛选逻辑与计数、点卡片主体打开人设预览、空态 antd Empty「暂无智能体档案」、加载 Spin、错误红条、删除确认弹窗、复制/默认切换数据流全部不变；既有测试用例行为断言不变（查询方式可随新 DOM 调整）。

#### 场景：既有用例回归

- Given：card / card-grid / page 三个既有测试文件
- When：跑测试
- Then：全部通过（允许按新 DOM 调整查询，行为断言不动）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/app/(dashboard)/agent-profiles/__tests__/page.test.tsx「页头统计胶囊（共 N 个档案·默认 M）」
FR-02: test/frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx「回车提交搜索：匹配 name 或 system_prompt，计数同步更新」（既有回归）
FR-03: test/frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx「默认档案品牌光晕类」；test/同文件「系统预置紧凑卡提示文案（引擎默认人设/能力/只读）」
FR-04: test/frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx「技能芯片超 4 项收敛 +N」；test/同文件「无技能自定义卡显『无技能（不挂载）』占位」
FR-05: test/frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx「设为默认/取消默认/编辑/复制/删除 回调与不冒泡」（既有回归）
FR-06: 不适用：静态样式约束（无硬编码 hex），验收以代码审查（grep 无新增 hex）+ 三主题人工截图（visual-evidence.md）为准
FR-07: test/frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx「三筛选/数据源切换/系统预置透传」+ test/page.test.tsx「新建/编辑/复制/删除/空态」既有用例全量回归
