import { clampToView, type DevicePoint, type Resolution } from '../../ui/resolution.ts';

function pixelRatio(): number {
  return globalThis.devicePixelRatio || 1;
}

function clientPoint(stage: HTMLElement, event: MouseEvent): DevicePoint {
  const rect = stage.getBoundingClientRect();
  const ratio = pixelRatio();
  return { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio };
}

export type GrabDocument = Pick<Document, 'addEventListener' | 'exitPointerLock' | 'pointerLockElement' | 'fullscreenElement'>;

export class MouseGrab {
  readonly #stage: HTMLElement;
  readonly #resolution: () => Resolution;
  readonly #document: GrabDocument;
  #wanted = false;
  #requesting = false;
  #device: DevicePoint = { x: 0, y: 0 };

  constructor(stage: HTMLElement, resolution: () => Resolution, signal: AbortSignal, doc: GrabDocument = document) {
    this.#stage = stage;
    this.#resolution = resolution;
    this.#document = doc;
    doc.addEventListener('pointerlockchange', () => this.#lockChanged(), { signal });
    doc.addEventListener('fullscreenchange', () => this.#fullscreenChanged(), { signal });
  }

  get locked(): boolean {
    return this.#document.pointerLockElement === this.#stage;
  }

  engage(): void {
    this.#wanted = true;
    this.regain();
  }

  release(): void {
    this.#wanted = false;
    if (this.locked) this.#document.exitPointerLock();
  }

  toggle(): void {
    if (this.#wanted) this.release();
    else this.engage();
  }

  regain(): void {
    if (!this.#wanted || this.locked || this.#requesting) return;
    this.#requesting = true;
    void Promise.resolve(this.#stage.requestPointerLock())
      .catch(() => undefined)
      .finally(() => {
        this.#requesting = false;
      });
  }

  movedTo(event: MouseEvent): DevicePoint {
    if (!this.locked) return this.at(event);
    const ratio = pixelRatio();
    return this.#keep({ x: this.#device.x + event.movementX * ratio, y: this.#device.y + event.movementY * ratio });
  }

  warpTo(point: DevicePoint): DevicePoint | null {
    return this.locked ? this.#keep(point) : null;
  }

  at(event: MouseEvent): DevicePoint {
    return this.#keep(this.locked ? this.#device : clientPoint(this.#stage, event));
  }

  #keep(point: DevicePoint): DevicePoint {
    this.#device = this.locked ? clampToView(this.#resolution(), point) : point;
    return this.#device;
  }

  #lockChanged(): void {
    if (!this.locked && !this.#inFullscreen()) this.#wanted = false;
  }

  #fullscreenChanged(): void {
    if (this.#inFullscreen()) this.engage();
    else this.release();
  }

  #inFullscreen(): boolean {
    return this.#document.fullscreenElement === this.#stage;
  }
}
