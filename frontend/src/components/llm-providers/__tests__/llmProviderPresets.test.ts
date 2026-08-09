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
});
