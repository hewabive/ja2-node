// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/game/Utils/Timer_Control.cc PauseTime, GetJA2Clock (the UI clock that stops while a message box is open;
// @src the wall clock GetClock keeps running for input repeat, double clicks and fast help).

export class UiClock {
  #now = 0;
  #pausedFor = 0;
  #pausedAt: number | null = null;
  #pauses = 0;

  advance(now: number): void {
    this.#now = now;
  }

  get now(): number {
    return this.#now;
  }

  get ja2Now(): number {
    return (this.#pausedAt ?? this.#now) - this.#pausedFor;
  }

  get paused(): boolean {
    return this.#pauses > 0;
  }

  pause(): void {
    if (this.#pauses++ === 0) this.#pausedAt = this.#now;
  }

  resume(): void {
    if (this.#pauses === 0) return;
    if (--this.#pauses > 0) return;
    this.#pausedFor += this.#now - (this.#pausedAt ?? this.#now);
    this.#pausedAt = null;
  }
}
