---
author: flow-machine-draft
created_at: 2026-10-19T07:28:14.196Z
---
# 提案书（Proposal）— 2026-10-19-translate-live-verify

## 动机

任务原话转写：翻译真机验证：换模型源与EOS修复

动机：2026-10-19-thinking-zh-translate 归档后的真机验证轮。联网实测发现两处问题并已修复：①默认模型 repo michaelfeil/ct2fast-opus-mt-en-zh 已 404（hf-mirror 实测，huggingface.co 直连被墙但镜像可用）——默认值更换为 jiangzhuo9357/opus-mt-en-zh-ct2（完整 ct2 布局，真机推理译文流畅）；②translate_worker 的 sentencepiece 分词路径缺 EOS 协议处理（ct2 opus-mt 转换 config 为 add_source_eos=false，须手动追加 </s>，否则解码无终止信号产生重复循环乱码——真模型冒烟实证）——已修复为 encode 追加 EOS piece、decode 剥特殊 piece；③新增 env 门控真模型端到端测试 test_live_engine.py（默认跳过，TRANSLATE_LIVE_TEST=1 触发，覆盖 worker 子进程与 POST /api/translate/thinking 全链路）。

成功标准：
- 真机 live 测试全绿：worker 子进程译文含中文且无重复循环乱码；端点全链路 engine_ready=true、译文 translated=true、围栏代码块与 URL 保护段原样保留
- 既有 translate 模块测试（mock 面）全绿零回归
- config.py 默认 repo 与 backend/app/modules/translate/README.md 一致指向可用仓库

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 真机 live 测试全绿：worker 子进程译文含中文且无重复循环乱码；端点全链路 engine_ready=true、译文 translated=true、围栏代码块与 URL 保护段原样保留
2. 既有 translate 模块测试（mock 面）全绿零回归
3. config.py 默认 repo 与 backend/app/modules/translate/README.md 一致指向可用仓库

## 成功标准（可验证）

1. 真机 live 测试全绿：worker 子进程译文含中文且无重复循环乱码；端点全链路 engine_ready=true、译文 translated=true、围栏代码块与 URL 保护段原样保留
2. 既有 translate 模块测试（mock 面）全绿零回归
3. config.py 默认 repo 与 backend/app/modules/translate/README.md 一致指向可用仓库
