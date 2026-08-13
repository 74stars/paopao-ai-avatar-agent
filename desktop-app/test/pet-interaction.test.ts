import { afterEach, describe, expect, it, vi } from "vitest";
import { createPetClickScheduler } from "../src/components/pet-interaction";

describe("pet click scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("cancels the pending single action when a double click arrives", () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const scheduler = createPetClickScheduler({ onSingle, onDouble, delayMs: 220 });

    scheduler.click();
    scheduler.click();
    vi.advanceTimersByTime(300);

    expect(onSingle).not.toHaveBeenCalled();
    expect(onDouble).toHaveBeenCalledOnce();
    scheduler.dispose();
  });

  it("treats a click after the product interval as a new single click", () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const scheduler = createPetClickScheduler({ onSingle, onDouble, delayMs: 220 });

    scheduler.click();
    vi.advanceTimersByTime(220);
    scheduler.click();
    vi.advanceTimersByTime(220);

    expect(onSingle).toHaveBeenCalledTimes(2);
    expect(onDouble).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("executes one single action after the double-click window", () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const scheduler = createPetClickScheduler({ onSingle, onDouble: vi.fn(), delayMs: 220 });

    scheduler.click();
    vi.advanceTimersByTime(219);
    expect(onSingle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSingle).toHaveBeenCalledOnce();
    scheduler.dispose();
  });
});
