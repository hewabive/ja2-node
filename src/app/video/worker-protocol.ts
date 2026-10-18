export interface OpenRequest {
  readonly kind: 'open';
  readonly bytes: ArrayBuffer;
}

export interface FrameRequest {
  readonly kind: 'frame';
  readonly target: number;
}

export type DecoderRequest = OpenRequest | FrameRequest;

export interface DecodedAudio {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array<ArrayBuffer>[];
}

export interface OpenedReply {
  readonly kind: 'opened';
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly microsPerFrame: number;
  readonly audio: DecodedAudio | null;
}

export interface FrameReply {
  readonly kind: 'frame';
  readonly index: number;
  readonly decoded: number;
  readonly decodeMs: number;
  readonly indices: Uint8Array<ArrayBuffer>;
  readonly palette: Uint8Array<ArrayBuffer>;
}

export interface ErrorReply {
  readonly kind: 'error';
  readonly message: string;
}

export type DecoderReply = OpenedReply | FrameReply | ErrorReply;
