---
author: flow-machine-draft
created_at: 2026-10-19T07:28:14.197Z
---
# 设计记录（Design Record）— 2026-10-19-translate-live-verify

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-19-thinking-zh-translate 归档后的真机验证轮，联网实测暴露两处问题并修复：

1. **默认模型 repo 404**：huggingface.co 直连被墙，hf-mirror.com 镜像可用；镜像 API 实测原默认 `michaelfeil/ct2fast-opus-mt-en-zh` 已不存在（api 401 / resolve 404，对照 Helsinki-NLP/opus-mt-en-zh 返回 200 排除镜像故障）。搜索镜像 ct2 格式候选后更换为 `jiangzhuo9357/opus-mt-en-zh-ct2`（config.json + model.bin 76MB int8 + source/target.spm 完整布局，917 下载量），config.py 默认值与 README 三处引用同步更换。
2. **EOS 协议缺失导致重复循环乱码**：真模型冒烟输出「代理代理代理…。 。 。」型乱码——根因是 ct2 的 opus-mt 转换 config 为 `add_source_eos: false`（调用方必须自行追加 `</s>`），worker 的 sentencepiece 分词回退路径没加 EOS → 解码端无终止信号，束搜重复生成到 max_decoding_length。修复：encode 尾追 EOS piece（从 spm eos_id 派生）、decode 剥离特殊 piece；修复后译文流畅（3 条 2.2s 含模型加载）。
3. 新增 env 门控 live 测试 `test_live_engine.py`（TRANSLATE_LIVE_TEST=1 才跑，默认 skip 零 CI 成本）：worker 子进程级 + POST 端点全链路级（真引擎零 mock），带 EOS 乱码指纹回归断言（同 2 字符片段连续重复 ≥8 次）与保护段（围栏/URL）原样保留断言。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化（修复轮）。内部行为两处变化：`Settings.translate_model_repo` 默认值更换（env TRANSLATE_MODEL_REPO 可覆盖，契约不变）；`translate_worker._Tokenizers` sentencepiece 路径 encode 追加 EOS / decode 剥特殊 piece（transformers 路径原本就由 add_special_tokens/skip_special_tokens 覆盖，不受影响）。新增测试文件为 env 门控测试面，非运行时接口。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不涉及事件流；EOS piece 由 spm eos_id 派生（缺席时回退 "</s>" 字面量），与到达顺序无关。
2. 并发写：无共享可变状态变化；EOS 修复是纯函数级（encode/decode），repo 更换是配置默认值。
3. 切换/生命周期：worker 子进程生命周期（三闸自灭/重启）不变；live 测试 autouse fixture 前后 reset 引擎单例与缓存，不污染其它测试。
4. 作用域：repo 默认值是进程级配置，多实例各自生效；live 测试门控读进程 env，跨环境默认 skip 无副作用。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：第三方个人仓库（jiangzhuo9357）可能失联/删除——缓解：TRANSLATE_MODEL_REPO env 可换任意 ct2 仓库、TRANSLATE_MODEL_DIR 指本地目录彻底离线、README 预烤文档已覆盖。放弃的方案：`ooeoeo/opus-mt-en-zh-ct2-float16`（float16 权重 CPU 推理不友好，且无必要）；本地 ct2-transformers-converter 自行转换 Helsinki-NLP/opus-mt-en-zh（需装 torch ~200MB，重且慢于直接用现成 int8 转换）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/core/config.py | translate_model_repo 默认值更换 + 真机验证注释 |
| 修改 | backend/app/modules/translate/translate_worker.py | sentencepiece 路径 EOS 协议修复（encode 追加 / decode 剥离） |
| 修改 | backend/app/modules/translate/README.md | 默认 repo 三处引用同步更换 |
| 新增 | backend/app/modules/translate/tests/test_live_engine.py | env 门控真模型 E2E 测试（worker + 端点两级） |
