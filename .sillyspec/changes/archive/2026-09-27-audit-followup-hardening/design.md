---
author: flow-machine-draft
created_at: 2026-09-26T23:28:32.583Z
---
# 设计记录（Design Record）— 2026-09-27-audit-followup-hardening

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
四项独立小修：①assets.py 新增纯函数 `_safe_module_doc`（POSIX 绝对/UNC、Windows 盘符、反斜杠归一、`..` 段四形态判越界），`_read_touched_modules` 对 doc 值过闸——越界返回 None：不读盘、不放前端预览 chip，模块名回退 id（既有回退路径）；②docker-compose frontend 删运行时 `NEXT_PUBLIC_COMMIT_SHA` 空覆盖行并留与 backend 同口径注释（版本号一律构建期烘焙）；③gen-api-types.mjs 守卫提示 `join("\n")`/`：\n` 双反斜杠改单反斜杠（字面两字符→真实换行）；④234000 迁移 docstring 补运维注记：alembic_version 卡在被删修订 20260926063000/3931ff71bd32 的库 upgrade 报 Can't locate revision，须 stamp 20260926083000 后再 upgrade。选守卫丢弃而非「resolve 后白名单校验」：读面本就只需 h1，越界值无合法语义，丢弃即 fail-closed 最简形态。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
assets：`_read_touched_modules` 行为变化仅「越界 doc 值」——此前尝试读盘（h1 提取，失败回退 id）且 doc 字段外发越界路径，现在不读盘且 doc=None；正常相对 doc 逐字节零回归；`_safe_module_doc` 为模块私有新函数无导出面。compose：frontend 服务 environment 删一行（部署面，无代码签名）。gen 脚本：stderr 文案格式变化（换行真实化）。迁移：docstring-only，revision graph 零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：模块图逐图 fail-open 语义未动，单图损坏跳过不变；doc 守卫是纯函数无状态。
2. 并发写：`_safe_module_doc` 纯字符串判定无共享态；读盘仍在原 read_text 一次性路径。
3. 切换/生命周期：无新资源/定时器/句柄；compose 与 gen 脚本变更在部署/构建期一次性生效。
4. 作用域：doc 值按 docs/<project> 域判界，跨工作区零串面（spec_root 每工作区独立解析不变）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-audit-followup-hardening 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：合法但形态特殊的 doc 值（如含反斜杠的合法相对路径）被误判越界丢弃 chip——影响面仅展示降级（名回退 id），不丢模块触达本身。试过放弃：①「resolve+is_relative_to 白名单」——Windows 大小写/符号链接语义跨三平台分歧大（规则 13），纯词法判定更可移植；②「doc 保留仅去 h1 读取」——越界路径仍外发给前端 chip 可点击，留下二次面；③「同步修 explorer 预览侧」——explorer 自有寻径防护（前端传参仅展示路径），无需重复设防。
