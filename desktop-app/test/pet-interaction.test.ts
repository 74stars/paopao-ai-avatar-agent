import { afterEach, describe, expect, it, vi } from "vitest";
import { createPetClickScheduler, createPetWindowDragController, isPetPrimaryMouseButton } from "../electron/pet-gesture";
import { petKeyboardAction } from "../src/components/PetWindow";

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

  it("cancels a click candidate when native window movement starts", () => {
    vi.useFakeTimers();
    const onSingle = vi.fn();
    const scheduler = createPetClickScheduler({ onSingle, onDouble: vi.fn(), delayMs: 220 });

    scheduler.click();
    scheduler.cancel();
    vi.advanceTimersByTime(300);

    expect(onSingle).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});

describe("pet keyboard actions", () => {
  it("provides separate capture and Library actions", () => {
    expect(petKeyboardAction("Enter")).toBe("capture");
    expect(petKeyboardAction(" ")).toBe("capture");
    expect(petKeyboardAction("Enter", true)).toBe("library");
    expect(petKeyboardAction("Escape")).toBeNull();
  });
});

describe("pet gesture recognizer", () => {
  it("accepts Electron mouse-up events without a button value", () => {
    expect(isPetPrimaryMouseButton(undefined)).toBe(true);
    expect(isPetPrimaryMouseButton("left")).toBe(true);
    expect(isPetPrimaryMouseButton("middle")).toBe(false);
    expect(isPetPrimaryMouseButton("right")).toBe(false);
  });

  it("treats a stationary release as a click", () => {
    const gesture = createPetWindowDragController();

    gesture.pointerDown(100, 80, 400, 300);

    expect(gesture.pointerUp(102, 81)).toBe("click");
  });

  it("treats movement beyond the threshold as a drag", () => {
    const gesture = createPetWindowDragController();

    gesture.pointerDown(100, 80, 400, 300);

    expect(gesture.pointerMove(103, 81)).toEqual({ x: 403, y: 301 });
    expect(gesture.pointerUp(103, 81)).toBe("drag");
  });

  it("keeps small pointer movements eligible for a click", () => {
    const gesture = createPetWindowDragController();

    gesture.pointerDown(100, 80, 400, 300);

    expect(gesture.pointerMove(102, 81)).toBeNull();
    expect(gesture.pointerUp(102, 81)).toBe("click");
  });

  it("clears an interrupted gesture without creating a click", () => {
    const gesture = createPetWindowDragController();

    gesture.pointerDown(100, 80, 400, 300);
    gesture.cancel();

    expect(gesture.pointerUp(100, 80)).toBeNull();
  });
});
