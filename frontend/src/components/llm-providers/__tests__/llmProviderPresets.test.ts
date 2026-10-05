/**
 * task-07（2026-08-08-llm-provider-openai-format）：预设 api_format 常量测（task-06 / D-001@v1）。
 *
 * 纯常量断言，无需 render：每条预设必含 api_format；opencode_zen_openai 为 openai_chat 且
 * base_url 正确、不预填 settings_config（经 LiteLLM 中转不直连上游）、归 aggregator 分类；
 * 其余预设为 anthropic。
 */
import { describe, it, expect } from "vitest";

import {
  LLM_PROVIDER_PRESETS,
  PRESETS_BY_CATEGORY,
  PRESET_BY_KEY,
} from "@/config/llmProviderPresets";

describe("LLM_PROVIDER_PRESETS — api_format 字段（task-06 / D-001@v1）", () => {
  it("每条预设均含 api_format 字段（anthropic|openai_chat）", () => {
    expect(LLM_PROVIDER_PRESETS.length).toBeGreaterThan(0);
    for (const p of LLM_PROVIDER_PRESETS) {
      expect(p.api_format).toMatch(/^(anthropic|openai_chat)$/);
    }
  });

  it("opencode_zen_openai 存在且为 openai_chat + 正确 base_url", () => {
    const p = PRESET_BY_KEY["opencode_zen_openai"];
    expect(p).toBeDefined();
    expect(p!.api_format).toBe("openai_chat");
    expect(p!.base_url).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("opencode_zen_openai 不预填 settings_config（经 LiteLLM 中转，不直连上游）", () => {
    const p = PRESET_BY_KEY["opencode_zen_openai"];
    expect(p!.settings_config_partial).toBeUndefined();
  });

  it("除 opencode_zen_openai 外其余预设均为 anthropic", () => {
    const anthropic = LLM_PROVIDER_PRESETS.filter(
      (p) => p.api_format === "anthropic",
    );
    // 11 个原有预设 + opencode_zen_openai(openai) = 总数；anthropic = 总数 - 1
    expect(anthropic.length).toBe(LLM_PROVIDER_PRESETS.length - 1);
  });

  it("opencode_zen_openai 归入 aggregator 分类（与 opencode_go 同组）", () => {
    const agg = PRESETS_BY_CATEGORY.find((g) => g.category === "aggregator");
    expect(agg).toBeDefined();
    expect(
      agg!.items.some((p) => p.key === "opencode_zen_openai"),
    ).toBe(true);
  });

  it("opencode_go 仍为 anthropic（与 opencode_zen_openai 区分）", () => {
    const go = PRESET_BY_KEY["opencode_go"];
    expect(go).toBeDefined();
    expect(go!.api_format).toBe("anthropic");
  });

  // 2026-10-06-opencode-go-direct-anthropic：opencode /zen/go/v1/messages 仅认 x-api-key
  //（Bearer 恒 401 AuthError，阿里云服务器实测），auth_field 必须是 ANTHROPIC_API_KEY
  //（原抄 cc-switch 的 ANTHROPIC_AUTH_TOKEN 配出来必 401）。
  it("opencode_go auth_field 为 ANTHROPIC_API_KEY（/v1/messages 仅认 x-api-key）", () => {
    const go = PRESET_BY_KEY["opencode_go"];
    expect(go).toBeDefined();
    expect(go!.auth_field).toBe("ANTHROPIC_API_KEY");
  });

  // 4 角色槽全填同一模型：Claude Code 副通道（标题/摘要）缺省发内置档位名，opencode
  // 无此模型名会失败（gap-D 同型）；槽位模型与 default_model 一致（deepseek-v4.1-flash）。
  it("opencode_go 4 角色槽与主模型全填 deepseek-v4.1-flash", () => {
    const go = PRESET_BY_KEY["opencode_go"];
    expect(go).toBeDefined();
    expect(go!.default_model).toBe("deepseek-v4.1-flash");
    const env = go!.settings_config_partial?.env as Record<string, string>;
    expect(env.ANTHROPIC_MODEL).toBe("deepseek-v4.1-flash");
    for (const role of ["HAIKU", "SONNET", "OPUS", "FABLE"] as const) {
      expect(env[`ANTHROPIC_DEFAULT_${role}_MODEL`]).toBe("deepseek-v4.1-flash");
    }
  });
});

// ql-20260823-007：预设永不预填认证键空占位。空串 ANTHROPIC_AUTH_TOKEN 会在 daemon
// 注入链（credential-injector 规则 7 修复前）把真实 api_key 覆盖成空串 → 会话报
// "Not logged in · Please run /login"。密钥只走表单专用 API Key 字段。
describe("LLM_PROVIDER_PRESETS — 不预填认证键（ql-20260823-007）", () => {
  it("所有预设 settings_config_partial.env 均不含空串认证键（ANTHROPIC_AUTH_TOKEN/API_KEY）", () => {
    for (const p of LLM_PROVIDER_PRESETS) {
      const env = (
        p.settings_config_partial as { env?: Record<string, unknown> } | undefined
      )?.env;
      if (!env) continue;
      for (const [k, v] of Object.entries(env)) {
        if (k === "ANTHROPIC_AUTH_TOKEN" || k === "ANTHROPIC_API_KEY") {
          expect(
            v,
            `预设 ${p.key} 不应预填认证键 ${k}（空占位会覆盖真实 key）`,
          ).not.toBe("");
        }
      }
    }
  });
});
