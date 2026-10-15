export interface DebugHook {
  ready: boolean;
  current: string | null;
  frames: number;
  lastQuads: number;
  error: string | null;
}

declare global {
  interface Window {
    __ja2AssetBrowser: DebugHook;
  }
}
