// 2026-10-23-semantic-color-scale-fix：语义色数字阶配置断言。
//
// 背景：warning/info/destructive 曾只有 DEFAULT+foreground，而组件使用
// -50/-200/-500/-700 类名——Tailwind 对未定义键静默不生成 CSS，导致左栏琥珀点
// 透明、活性徽章软底/描边/深字丢失。本测试钉住配置面，防止再次「类名写了但
// 配置没定义」的静默失效（渲染级验证另见变更目录 visual-evidence.md 的构建记录）。
import { describe, it, expect } from "vitest";

import config from "../../../tailwind.config";

/** 调色板对象：DEFAULT/foreground 为字符串，数字阶可能为字符串或函数（brand/slate）。 */
type Palette = Record<string, unknown> & {
  DEFAULT?: string;
  foreground?: string;
};

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Palette>;

function palette(name: string): Palette {
  const p = colors[name];
  expect(p, `${name} 调色板缺失`).toBeTruthy();
  return p!;
}

describe("tailwind 语义色数字阶（2026-10-23-semantic-color-scale-fix）", () => {
  const names = ["warning", "info", "destructive"] as const;

  for (const name of names) {
    it(`${name} 的 50/200/500/700 存在且派生形态正确`, () => {
      const scale = palette(name);

      // 500 = 基色本体
      expect(scale[500]).toBe(`hsl(var(--${name}))`);
      // 50/200 = 向背景色混出的软底
      expect(scale[50]).toContain("color-mix");
      expect(scale[50]).toContain(`hsl(var(--${name}))`);
      expect(scale[50]).toContain("hsl(var(--background))");
      expect(scale[200]).toContain("color-mix");
      expect(scale[200]).toContain("hsl(var(--background))");
      // 700 = 向前景色混出的字色；50% 基色占比是对照 WCAG AA 复算后的下限
      // （评审 P2：75% 时两套浅色主题最差 3.08:1，50% 时最差 5.07:1）
      expect(scale[700]).toContain("color-mix");
      expect(scale[700]).toContain("hsl(var(--foreground))");
      expect(scale[700]).toContain("50%, hsl(var(--foreground))");
    });
  }

  it("DEFAULT/foreground 零漂移，既有 brand/slate 色阶不受影响", () => {
    expect(palette("warning").DEFAULT).toBe("hsl(var(--warning))");
    expect(palette("warning").foreground).toBe("hsl(var(--warning-foreground))");
    expect(palette("info").DEFAULT).toBe("hsl(var(--info))");
    expect(palette("info").foreground).toBe("hsl(var(--info-foreground))");
    expect(palette("destructive").DEFAULT).toBe("hsl(var(--destructive))");
    expect(palette("destructive").foreground).toBe(
      "hsl(var(--destructive-foreground))",
    );
    // 既有函数式色阶原样保留（品牌/中性阶）
    expect(palette("brand")[500]).toBeTypeOf("function");
    expect(palette("slate")[500]).toBeTypeOf("function");
  });
});
