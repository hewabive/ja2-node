export interface FrameLoopOptions {
  readonly now: () => number;
  readonly requestFrame: (callback: () => void) => void;
  readonly frame: (now: number) => void;
  readonly failed?: (error: unknown) => void;
}

export interface FrameLoop {
  stop(): void;
}

export function startFrameLoop(options: FrameLoopOptions): FrameLoop {
  let running = true;
  const tick = () => {
    if (!running) return;
    try {
      options.frame(options.now());
    } catch (error) {
      running = false;
      options.failed?.(error);
      return;
    }
    options.requestFrame(tick);
  };
  options.requestFrame(tick);
  return {
    stop: () => {
      running = false;
    },
  };
}
