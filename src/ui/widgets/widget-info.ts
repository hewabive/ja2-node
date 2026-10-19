export interface WidgetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WidgetInfo {
  readonly id: string;
  readonly kind: string;
  readonly rect: WidgetRect;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly state: string | number | boolean | null;
  readonly text: string | null;
  readonly frame: number | null;
}

export interface Describable {
  describe(): readonly WidgetInfo[];
}

export function widgetRect(x: number, y: number, width: number, height: number): WidgetRect {
  return { x, y, width, height };
}
