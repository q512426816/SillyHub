---
author: qinyi
created_at: 2026-10-15 24:00:00
---

# step prompt 动态注入段只在首次渲染出现，重跑不可回读（活跃坑）

## 现象

`brainstorm` src/review-tier.js（第 7 步 Design Grill）的 prompt 分两部分：

- **静态段**：指引全文，落盘在 `.sillyspec/.runtime/step-guides/<stage>-step<N>-<fingerprint>.md`，可用 fingerprint 回读；
- **动态段**：由 CLI 每次渲染时注入，含 **ceremony 档位行**（`tier: independent（理由）` + 档位菜单）、**评审材料包**（`assembleStageReviewMaterials('grill-first')` 的 design 要点 digest + 文件清单）、时间戳、路径与平台规则、已知失败项等。

问题：**动态段没有任何落盘或回读通道**。

## 复现（2026-10-15-change-detail-redesign 实证）

1. `sillyspec run brainstorm --change <名> --done ... | tail -35` —— 按常规习惯只截尾部，动态段的档位行与材料包落在被截断的头部，丢失。
2. 重新 `sillyspec run brainstorm --change <名>` 想补看 → 输出仅 50 行，内容是「⚠️ 已进行到第 7/8 步」+ 「历史用户回答回放」+ 「📄 步骤指引未变（fingerprint=54ee5fc4）——**静态全文不再重印**」。**动态段同样不再重印**。
3. 尝试 `sillyspec review status --change <名>` → 只返回 review.json 的期望路径与三态状态，**不含 tier**。
4. 无其它命令可回读该动态段（`progress show` 也不含）。

## 影响

- 主代理在派发独立审查子代理前拿不到档位，只能反推：读 CLI 源码 `src/review-tier.js`
  （`computeReviewTier` 的 blast/span/friction 三轴定价）与 `src/ceremony-tier.js`（`computeCeremonyTier`），
  或按经验猜（本例按「多文件 + 新算法 + CLI 已写 review run-id marker」判断走 independent，属推理而非读取）。
- 若猜错档位：猜低 → 该派独立审查却自审（质量门虚设）；猜高 → 无谓开销。
- 材料包丢失的后果更重：评审子代理的「五个交叉点」需主代理补齐，材料包本身也要贴进派发 prompt——重跑拿不到就得重编（本例由主代理按 design.md/decisions.md 自建等价物，可接受但不保真）。

## 建议修复（供工具侧参考）

1. 渲染时把动态段落盘（如 `.runtime/step-guides/<stage>-step<N>-<fingerprint>.dyn.md` 或 `.json`），重跑可回读；
2. 或在「步骤指引未变」提示里**附带动态段关键行**（档位行一行 + 材料包路径即可解决大半）；
3. 或给只读子命令：`sillyspec run <stage> --show-dyn [--step N]`。

## 当前绕过方案（照此执行）

**首次渲染输出一律重定向落盘，不截断**：

```bash
sillyspec run brainstorm --change <名> > /tmp/step.txt 2>&1   # 勿直接接 tail/head
grep -n "tier\|材料包\|交叉点" /tmp/step.txt
```

已二次渲染后才发现的：读 `<sillyspec 安装目录>/src/review-tier.js` + `src/ceremony-tier.js` 反推档位，
并按 design.md / decisions.md 自建评审材料包（在派发 prompt 中说明「材料包由主代理等价自建」）。
