import { describe, expect, it, vi } from "vitest";

// useBackClose is a hook; here it only needs useEffect and useRef to run.
const effects: (() => void | (() => void))[] = [];
vi.mock("react", () => ({
  useEffect: (fn: () => void | (() => void)) => effects.push(fn),
  useRef: (v: unknown) => ({ current: v }),
}));

import { closeTopLayer, useBackClose } from "./backStack";

const mount = (close: () => void) => {
  effects.length = 0;
  useBackClose(close);
  return effects[0]() as () => void;
};

describe("back stack", () => {
  it("closes the innermost layer first", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const unmountOuter = mount(outer);
    const unmountInner = mount(inner);
    expect(closeTopLayer()).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    unmountInner();
    expect(closeTopLayer()).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
    unmountOuter();
    expect(closeTopLayer()).toBe(false);
  });
});
