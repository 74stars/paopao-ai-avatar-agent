export interface PetClickScheduler {
  click(): void;
  dispose(): void;
}

export function createPetClickScheduler(options: { onSingle(): void; onDouble(): void; delayMs?: number }): PetClickScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delayMs = options.delayMs ?? 350;

  return {
    click() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        options.onDouble();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        options.onSingle();
      }, delayMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}
