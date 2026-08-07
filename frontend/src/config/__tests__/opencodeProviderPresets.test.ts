/**
 * opencodeProviderPresets 数据不变量测试（quick ql-20260807-004-e5bf）。
 *
 * 纯数据校验，守护「数据先备好」的可信度：预设逐字抄 cc-switch 后可能手滑（漏剔
 * affiliate / 打错 key / 泄露 apiKey），本测试把不变量钉死，未来接入表单也不会因
 * 脏数据漂移。零依赖（不 import React，纯 node 环境可跑）。
 */
import { describe, it, expect } from "vitest";

import {
  OPENCODE_PROVIDER_PRESETS,
  OPENCODE_PRESET_BY_KEY,
  OPENCODE_PRESETS_BY_CATEGORY,
} from "@/config/opencodeProviderPresets";

/** cc-switch opencode 允许的 @ai-sdk npm 包（opencodeProviderPresets.ts 定义）。 */
const KNOWN_NPM = new Set([
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/anthropic",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/google",
]);

/** 供应商名（opencode config provider key 不得空白）。 */
const hasText = (s: string | undefined): boolean =>
  typeof s === "string" && s.trim() !== "";

/** cc-switch affiliate 参数（R-05：预设 URL 不得携带，属 cc-switch 不属本平台）。 */
const AFFILIATE_PARAM_RE =
  /[?&](aff|ic|from|ref|invitecode|ac|utm_source|utm_medium|utm_campaign|utm_content|utm_term)=/i;

describe("opencodeProviderPresets 数据不变量（ql-20260807-004-e5bf）", () => {
  it("key 全局唯一（避免选择器 key 冲突）", () => {
    const keys = OPENCODE_PROVIDER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 派生索引与源数组一一对应
    expect(Object.keys(OPENCODE_PRESET_BY_KEY).sort()).toEqual([...keys].sort());
  });

  it("name / npm / base_url / category 必填且合法", () => {
    for (const p of OPENCODE_PROVIDER_PRESETS) {
      expect(hasText(p.name), `${p.key}.name`).toBe(true);
      expect(KNOWN_NPM.has(p.npm), `${p.key}.npm=${p.npm}`).toBe(true);
      expect(hasText(p.base_url), `${p.key}.base_url`).toBe(true);
      // opencode config 的 baseURL 不带尾斜杠（cc-switch 约定，带斜杠会拼错端点）
      expect(p.base_url.endsWith("/"), `${p.key} base_url 尾斜杠`).toBe(false);
      expect(["cn_official", "aggregator"]).toContain(p.category);
    }
  });

  it("website_url / api_key_url 必填且不含 affiliate 参数", () => {
    for (const p of OPENCODE_PROVIDER_PRESETS) {
      expect(hasText(p.website_url), `${p.key}.website_url`).toBe(true);
      expect(
        AFFILIATE_PARAM_RE.test(p.website_url),
        `${p.key}.website_url 含 affiliate 参数`,
      ).toBe(false);
      if (p.api_key_url) {
        expect(
          AFFILIATE_PARAM_RE.test(p.api_key_url),
          `${p.key}.api_key_url 含 affiliate 参数`,
        ).toBe(false);
      }
    }
  });

  it("预设绝不携带明文 apiKey（options.apiKey 永不出现在数据里）", () => {
    const dump = JSON.stringify(OPENCODE_PROVIDER_PRESETS);
    // 匹配属性键 `"apiKey"` 或 `"api_key"`（opencode config 的 options.apiKey 由用户
    // 手填，预设不得携带）；不匹配 `api_key_url`（控制台取 key 链接，合法字段）。
    expect(/api_?key"/i.test(dump)).toBe(false);
  });

  it("models 的 modelId 非空，条目值合法（bailian 空 models 放行）", () => {
    for (const p of OPENCODE_PROVIDER_PRESETS) {
      for (const [modelId, m] of Object.entries(p.models)) {
        expect(hasText(modelId), `${p.key}.models 空 modelId`).toBe(true);
        expect(typeof m, `${p.key}.models[${modelId}]`).toBe("object");
        if (m.name !== undefined) {
          expect(hasText(m.name), `${p.key}.models[${modelId}].name`).toBe(true);
        }
      }
    }
  });

  it("分组索引覆盖全部预设且组内保序", () => {
    const grouped = OPENCODE_PRESETS_BY_CATEGORY.flatMap((g) => g.items);
    expect(grouped).toEqual(OPENCODE_PROVIDER_PRESETS);
  });

  it("类型约束：每个预设都是 OpencodeProviderPreset（编译期校验占位）", () => {
    // TS 已静态校验 OPENCODE_PROVIDER_PRESETS 数组字面量满足类型；
    // 运行时用断言守卫未来可能的 any 强转。find 取首元素避免
    // noUncheckedIndexedAccess 的 `| undefined`。
    const first = OPENCODE_PROVIDER_PRESETS.find((p) => p.key !== undefined);
    expect(first).toBeDefined();
    expect(first!.key).toBeTypeOf("string");
    expect(typeof first!.models).toBe("object");
  });
});
