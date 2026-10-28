// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Laptop/Florist_Order_Form.cc CreateDestroyFlowerOrderDestDropDown (the rows every font height + 2, the
// @src regions from +4 to the font height, the height of the list + 10, the tactpopup.sti border every 10 pixels, the
// @src bottom row 6 pixels lower), SelectFlowerDropDownMovementCallBack (hovering selects), SelectFlowerDropDownRegionCallBack
// @src (a click selects and closes), SelectFloristDisableDropDownRegionCallBack, FlowerOrderDrawSelectedCity.

const ROW_GAP = 2;
const LIST_MARGIN = 10;
const BORDER_STEP = 10;
const REGION_TOP = 4;

export interface DestinationListGeometry {
  readonly rowStep: number;
  readonly regionHeight: number;
  readonly height: number;
  readonly topPieces: number;
  readonly sidePieces: number;
}

function piecesBetween(length: number): number {
  return Math.max(0, Math.ceil((length - 2 * BORDER_STEP) / BORDER_STEP));
}

export function destinationListGeometry(rows: number, fontHeight: number, width: number): DestinationListGeometry {
  const rowStep = fontHeight + ROW_GAP;
  const height = rows * rowStep + LIST_MARGIN;
  return {
    rowStep,
    regionHeight: fontHeight - REGION_TOP,
    height,
    topPieces: piecesBetween(width),
    sidePieces: piecesBetween(height),
  };
}

export class DestinationList {
  readonly rows: readonly string[];
  open = false;
  #selected: number;
  readonly #select: (index: number) => void;

  constructor(rows: readonly string[], selected: number, select: (index: number) => void) {
    this.rows = rows;
    this.#selected = selected;
    this.#select = select;
  }

  get selected(): number {
    return this.#selected;
  }

  show(): void {
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  #choose(index: number): void {
    if (index < 0 || index >= this.rows.length) return;
    this.#selected = index;
    this.#select(index);
  }

  hover(index: number, on: boolean): void {
    if (this.open && on) this.#choose(index);
  }

  pick(index: number): void {
    if (!this.open) return;
    this.#choose(index);
    this.hide();
  }
}
