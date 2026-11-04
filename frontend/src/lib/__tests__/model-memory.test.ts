/**
 * model-memory 单测（2026-11-04-model-provider-cascade FR-03）：
 * remember/get 读写闭环、缺键 null、坏 JSON 容错、非法入参静默。
 */

import { afterEach, describe, expect, it } from "vitest";

import { getLastModel, rememberLastModel } from "@/lib/model-memory";

describe("model-memory（供应商→模型本地记忆）", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("remember 后 get 闭环命中（JSON 透明）", () => {
    rememberLastModel("p-1", "glm-5.3-flash");
    expect(getLastModel("p-1")).toBe("glm-5.3-flash");
    // 底层确为 localStorage（跨调用可读）
    expect(window.localStorage.getItem("sh:last-model:p-1")).toBe(
      JSON.stringify("glm-5.3-flash"),
    );
  });

  it("缺键返回 null", () => {
    expect(getLastModel("p-none")).toBeNull();
  });

  it("坏 JSON 容错返回 null 不抛错", () => {
    window.localStorage.setItem("sh:last-model:p-bad", "{not-json");
    expect(getLastModel("p-bad")).toBeNull();
  });

  it("非字符串/空串 JSON 值视为无记忆", () => {
    window.localStorage.setItem("sh:last-model:p-num", "42");
    expect(getLastModel("p-num")).toBeNull();
    window.localStorage.setItem("sh:last-model:p-empty", '""');
    expect(getLastModel("p-empty")).toBeNull();
  });

  it("空 providerId/model 入参静默不写入", () => {
    rememberLastModel("", "m");
    rememberLastModel("p", "");
    expect(window.localStorage.length).toBe(0);
    expect(getLastModel("")).toBeNull();
  });

  it("同供应商重复写入取最新", () => {
    rememberLastModel("p-1", "m1");
    rememberLastModel("p-1", "m2");
    expect(getLastModel("p-1")).toBe("m2");
  });
});
