---
author: flow-machine-draft
created_at: 2026-10-22T01:29:54.658Z
---
# 需求规格（Requirements）— 2026-10-22-agent-profile-modal-restyle

## 功能需求

### FR-01: 弹窗观感对齐已确认原型：品牌图标头+副标题、页脚左侧红线注脚（单行省略）、品牌竖条小节头

- 新建/编辑弹窗必须以「品牌图标 + 标题 + 副标题『一份人格 + 一份技能清单，跨会话复用』」作为弹窗头；红线提示（文案逐字不变）必须移至页脚左侧以单行省略展示（悬停可见全文，title 提示）；「身份」「技能」小节头必须呈现品牌竖条 + 小节名 + 说明文案（两节说明文案与现版逐字一致），禁止保留旧 Divider 形态小节头。
- 依据：用户确认的原型 `.sillyspec/explore/prototype-agent-profile-modal-restyle.html`（两轮反馈定稿）。

#### 场景：打开新建弹窗

- Given：用户在 /agent-profiles 点击「+ 新建档案」
- When：弹窗渲染完成
- Then：弹窗头显示品牌图标与副标题；页脚左侧出现「档案不存任何 API Key / 凭证」注脚（单行省略）；身份/技能小节头带品牌竖条且说明文案与现版逐字一致

### FR-02: 技能区：全选复选（半选态、仅作用于当前筛选结果）+ 按名称与简介搜索 + 已选 N/总数计数 + 清空按钮 + 两行芯片网格（名称+一行简介，限高内滚）

- 技能区必须提供：全选复选（部分选中呈半选态 indeterminate；勾选/取消仅作用于当前搜索筛选后的可见项）、搜索框（必须同时按技能名与简介匹配）、「已选 N / 总数」计数（分母恒为全集）、清空按钮（无选中时隐藏或不可点）；技能项必须以两行芯片呈现（第一行复选标记+技能名，第二行一行简介、超长截断省略并悬停可见全文），技能总数超出限高时必须在芯片容器内滚动（不把左栏撑出滚动条）。
- 技能芯片必须可键盘操作（Tab 可达、空格/回车切换选中）。

#### 场景：全选与半选

- Given：技能 21 项全部未选，全选复选未选中
- When：勾选全选
- Then：所有芯片选中，计数 21/21
- When：再取消其中 1 项
- Then：全选复选呈半选态，计数 20/21

#### 场景：搜索下全选仅作用于筛选结果

- Given：搜索关键词仅命中 1 项
- When：勾选全选
- Then：仅该 1 项被选中，计数 1/21；清空搜索后其余 20 项仍为未选中

### FR-03: 技能简介来自真实数据（manifest SKILL.md frontmatter description / 自定义技能 description），非硬编码

- 技能芯片简介必须取自 useCustomSkills 返回的 description 与 usePlatformSkillsManifest 的 skills[].description（并集去重时同名自定义技能优先占据取值）；无简介时 SHOULD 显示「（暂无简介）」占位；禁止在组件内硬编码任何技能描述文案。

#### 场景：并集与简介渲染

- Given：自定义技能 my-skill（description=「自定义描述」）与平台技能 sillyspec-auto（description=「自动模式…」）
- When：打开弹窗
- Then：两技能芯片均出现且各自显示其数据源描述；右栏预览技能 chips 悬停可见对应简介

### FR-04: 技能区滚动条三主题下细样式半透明，暗夜不刺眼（作用域限本弹窗技能区）

- 技能芯片滚动容器必须应用主题化细滚动条（globals.css 作用域工具类 .thin-scroll + 三主题 --scroll-thumb/--scroll-thumb-hover 半透明取值，暗夜为低透明度白色系避免刺眼）；滚动条定制禁止波及全局其它滚动区（选择器必须限定在工具类内）。

#### 场景：暗夜主题滚动

- Given：暗夜主题且技能数超出芯片区限高
- When：芯片区滚动
- Then：滚动条为半透明深色细样式，非浏览器默认亮白样式

### FR-05: 无硬编码 hex，颜色走 brand/语义 token，三主题（blue/ai-native/dark）可切换

- 本次新增的全部样式必须使用 brand-*/语义 token（tailwind 类或 var(--*) CSS 变量，含 rgba 透明度修饰），禁止新增硬编码 hex 色值；三主题切换下弹窗配色（图标头/选中芯片/主按钮/注脚）必须正确跟随。

#### 场景：三主题切换

- Given：依次切换 ai-native / blue / dark
- When：打开弹窗
- Then：品牌色元素随主题换色，无残留错配

### FR-06: 既有行为回归不变：可见范围=工作区时出现归属工作区选择器、右栏预览实时联动、名称必填、红线文案不变

- 重构必须保持既有行为：visibility=workspace 且无路由 ws 时归属工作区选择器出现（private/platform 不出现）；右栏预览随名称/提示词/技能/可见范围实时联动；名称必填与中文校验文案不变；红线提示文案逐字不变；Modal maskClosable=false、destroyOnClose、取消/保存按钮语义与提交路径（useCreate/useUpdate + notify）不变；toCreateBody/toUpdateBody 组装逻辑与后端契约（skill_refs: string[]）零变化。

#### 场景：既有用例回归

- Given：agent-profile-form.test.tsx 既有用例集（body 组装/四字段渲染/归属选择器/提交路径）
- When：跑测试
- Then：全部通过（查询方式可随新 DOM 调整，行为断言不变）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「弹窗观感：品牌图标头副标题 + 页脚红线注脚 + 品牌竖条小节头」
FR-02: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「技能全选/半选/清空/计数」；test/frontend/src/components/__tests__/agent-profile-form.test.tsx「搜索按名称与简介命中且全选仅作用于筛选结果」
FR-03: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「技能简介来自数据源并集渲染（自定义优先）」
FR-04: 不适用：滚动条伪元素样式 jsdom 无法断言，验收以 globals.css 作用域类实现 + 三主题人工截图（visual-evidence.md）为准
FR-05: 不适用：静态样式约束（无硬编码 hex），验收以代码审查（grep 无新增 hex）+ 三主题人工截图（visual-evidence.md）为准
FR-06: test/frontend/src/components/__tests__/agent-profile-form.test.tsx「既有用例回归（body 组装/归属选择器/预览联动/提交路径）」
