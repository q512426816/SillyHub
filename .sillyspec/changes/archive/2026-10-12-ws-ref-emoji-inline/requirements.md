---
author: flow-machine-draft
created_at: 2026-10-12T01:11:49.293Z
---
# 需求规格（Requirements）— 2026-10-12-ws-ref-emoji-inline

## 功能需求

### FR-01: 输入框内引用标签（附件/文件/目录/代码块）文本形如【📄 name】，图标与文字同处文本流零错位

- 必须：构造层（attachment-refs.ts buildAttRefToken/buildWsRefToken）生成的 token 必须以类型 emoji 文本字符（📎/📄/📁/🧾）内嵌基名前位；禁止任何非文本图标元素（lucide inline）进入镜像高亮层文本流。

#### 场景：主路径

Given 输入区经右键/槽位插入任一类型引用 / When token 渲染 / Then textarea 纯文本与 overlay 占位文本同串同宽（emoji 为文本字符，逐字符对齐铁律成立）。

### FR-02: overlay 左上角类型角标移除，悬停 tooltip 元数据仍显示类型+路径+行号

- 必须：InputRefOverlay 禁止渲染左上类型角标（data-ws-ref-kind-badge 退役）；悬停命中 token 时必须经 hoverTip 浮层显示 tokenMetas.title 完整绑定元数据，指针移出必须隐藏。

#### 场景：主路径

Given 标签在场且指针悬停命中 / When hitTest 命中 / Then data-ws-ref-hover-tip 气泡渲染 title 文本；移出 → 气泡移除。

### FR-03: 同名 ·2 唯一化口径不因 emoji 前缀失效（手打【name】与槽位插入【📄 name】按基名正确撞池）

- 必须：同类型同名（emoji 相同）必须按 ·2 唯一化；跨类型同名与手打无 emoji 同名 SHOULD 不互斥（图标/形态已自区分，不构成显示歧义）。

#### 场景：同名碰撞

Given 池内已有【📄 design.md】 / When 再分配同类同名 file / Then 取【📄 design.md·2】；跨类型（📎 在池）分配 📄 同名 → 不加号。

### FR-04: 发送置换产物不变（map 全文匹配），退格整删/× 删除对新 token 形态正确

- 必须：置换/删除按 map 值全文匹配（token 含 emoji 自然成立），置换产物必须保持既有三类标记零变化；× 角标 aria-label 必须剥图标前缀只留名称。

#### 场景：发送与删除

Given token【🧾 a.py:10-16】在场 / When 发送 / Then 置换为 [代码引用:wid|path|L10-L16]；贴尾退格一次整删整枚 token。

### FR-05: 既有相关测试同步更新全绿，无引用时零视觉差异

- 必须：五个相关测试文件全绿；未插入任何引用时输入区渲染与行为必须与现状零差异。

#### 场景：零回归

Given 无引用 / Then overlay 不渲染（tokens 空返回 null），hoverTip 无渲染。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「基名 = 名称(+行号段无 L 前缀)；seq>1 加 ·N；emoji 按类型内嵌（📄/📁/🧾）」
FR-02: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 传入时渲染 fixed 元数据气泡；null 时零渲染」+「token（含内嵌 emoji）整段高亮为背景块；无左上类型角标（已随形态退役）」
FR-03: test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「同类型同名才互斥 ·2（emoji 前缀参与占用文本整体比对）」+「跨类型同名互不占位（emoji 图标自区分，不构成显示歧义）；手打无 emoji 亦不互斥」
FR-04: test/frontend/src/components/daemon/__tests__/attachment-refs.test.ts「file/dir/code 三类 token 置换为对应正式标记（emoji 内嵌形态全文匹配）」+ input-ref-overlay.test.tsx「× 角标 aria-label 剥离内嵌 emoji 前缀（提示语只留名称）」
FR-05: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx 端到端用例 + group-chat-panel.test.tsx 槽位族（193/193 合跑绿，logs/emoji-final3.log）
