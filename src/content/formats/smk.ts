import { FormatError } from '../binary/errors.ts';

export const SMK_SIGNATURE = 'SMK2';
export const SMK_HEADER_BYTES = 104;
export const SMK_MAX_AUDIO_TRACKS = 7;
export const SMK_BLOCK_SIZE = 4;
export const SMK_PALETTE_COLOURS = 256;
export const SMK_PALETTE_BYTES = SMK_PALETTE_COLOURS * 3;

export const SmkFlag = { RING_FRAME: 0x1, Y_INTERLACED: 0x2, Y_DOUBLED: 0x4 } as const;

export const SmkAudioFlag = {
  COMPRESSED: 0x80000000,
  PRESENT: 0x40000000,
  SIXTEEN_BIT: 0x20000000,
  STEREO: 0x10000000,
  BINK: 0x0c000000,
  RATE: 0x00ffffff,
} as const;

export const SmkFrameType = { PALETTE: 0x01, FIRST_AUDIO_TRACK: 0x02 } as const;
export const SMK_FRAME_SIZE_FLAGS = 0x3;

export const SmkBlock = { MONO: 0, FULL: 1, VOID: 2, SOLID: 3 } as const;
export type SmkBlock = (typeof SmkBlock)[keyof typeof SmkBlock];

export const SMK_BLOCK_TYPE_MASK = 0x3;
export const SMK_RUN_SHIFT = 2;
export const SMK_RUN_MASK = 0x3f;
export const SMK_BLOCK_EXTRA_SHIFT = 8;
const LONG_RUNS = [128, 256, 512, 1024, 2048];
const SHORT_RUN_COUNT = 59;
export const SMK_RUN_LENGTHS: readonly number[] = [...Array.from({ length: SHORT_RUN_COUNT }, (_, i) => i + 1), ...LONG_RUNS];

export const SmkPaletteCommand = { SKIP: 0x80, COPY: 0x40, SKIP_COUNT: 0x7f, COPY_COUNT: 0x3f, COMPONENT: 0x3f } as const;
export const SMK_PALETTE_CHUNK_UNIT = 4;

export const SMK_ESCAPE_SLOTS = 3;
export const SMK_TREE_COUNT = 4;
export const SMK_AUDIO_SIZE_BYTES = 4;

const MICROS_PER_MILLI = 1000;
const MICROS_PER_NEGATIVE_RATE_UNIT = 10;
const DEFAULT_MICROS_PER_FRAME = 100_000;
const MAX_DIMENSION = 4096;
const MAX_TREE_DEPTH = 256;
const BYTE_TREE_MAX_LEAVES = 256;
const BYTE_BITS = 8;
const WORD_BITS = 16;
const ESCAPE_LEAF = 0x10000;
const PCM_8_BIAS = 128;
const PCM_8_SHIFT = 8;
const MAX_AUDIO_CHUNK_BYTES = 1 << 24;
const BYTE_MASK = 0xff;
const WORD_MASK = 0xffff;
const SIX_BIT_SHIFT = 2;
const SIX_BIT_SPREAD = 4;

export interface SmkAudioTrack {
  readonly track: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly bitsPerSample: 8 | 16;
  readonly compressed: boolean;
}

export interface SmkFrameEntry {
  readonly offset: number;
  readonly size: number;
  readonly keyframe: boolean;
  readonly hasPalette: boolean;
  readonly audioTracks: number;
}

interface WordTree {
  readonly table: Int32Array;
}

interface VideoTrees {
  readonly monoMap: WordTree;
  readonly monoColours: WordTree;
  readonly full: WordTree;
  readonly type: WordTree;
}

export interface SmkVideo {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly microsPerFrame: number;
  readonly flags: number;
  readonly audioTracks: readonly SmkAudioTrack[];
  readonly frames: readonly SmkFrameEntry[];
  readonly bytes: Uint8Array;
  readonly trees: VideoTrees;
}

export interface SmkFrame {
  readonly index: number;
  readonly indices: Uint8Array;
  readonly palette: Uint8Array;
  readonly paletteChanged: boolean;
}

export function sixBitToEight(component: number): number {
  return ((component << SIX_BIT_SHIFT) | (component >> SIX_BIT_SPREAD)) & BYTE_MASK;
}

export function microsPerFrameOf(frameRate: number): number {
  if (frameRate > 0) return frameRate * MICROS_PER_MILLI;
  if (frameRate < 0) return -frameRate * MICROS_PER_NEGATIVE_RATE_UNIT;
  return DEFAULT_MICROS_PER_FRAME;
}

class BitReader {
  readonly #bytes: Uint8Array;
  readonly #end: number;
  readonly #what: string;
  #position: number;
  #buffer = 0;
  #count = 0;

  constructor(bytes: Uint8Array, start: number, end: number, what: string) {
    this.#bytes = bytes;
    this.#position = start;
    this.#end = end;
    this.#what = what;
  }

  bit(): number {
    if (this.#count === 0) {
      if (this.#position >= this.#end) throw new FormatError(`${this.#what} ends early`);
      this.#buffer = this.#bytes[this.#position++] as number;
      this.#count = BYTE_BITS;
    }
    const bit = this.#buffer & 1;
    this.#buffer >>= 1;
    this.#count--;
    return bit;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value |= this.bit() << i;
    return value >>> 0;
  }
}

const ABSENT_TREE = Int32Array.of(0);

function readByteTreeNode(reader: BitReader, entries: number[], depth: number): void {
  if (depth > MAX_TREE_DEPTH) throw new FormatError('Huffman tree is too deep');
  if (reader.bit()) {
    const branch = entries.length;
    entries.push(0);
    readByteTreeNode(reader, entries, depth + 1);
    entries[branch] = -entries.length;
    readByteTreeNode(reader, entries, depth + 1);
    return;
  }
  entries.push(reader.bits(BYTE_BITS));
  if (entries.length > 2 * BYTE_TREE_MAX_LEAVES) throw new FormatError('Huffman byte tree has too many leaves');
}

function readByteTree(reader: BitReader): Int32Array {
  if (!reader.bit()) return ABSENT_TREE;
  const entries: number[] = [];
  readByteTreeNode(reader, entries, 0);
  reader.bit();
  return Int32Array.from(entries);
}

function decodeTable(table: Int32Array, reader: BitReader): number {
  let node = 0;
  let entry = table[0] as number;
  while (entry < 0) {
    node = reader.bit() ? -entry : node + 1;
    entry = table[node] as number;
  }
  return entry;
}

interface WordTreeContext {
  readonly low: Int32Array;
  readonly high: Int32Array;
  readonly escapes: readonly number[];
  readonly escapeLeaves: number[];
  readonly entries: number[];
}

function readWordTreeNode(reader: BitReader, context: WordTreeContext, depth: number): void {
  if (depth > MAX_TREE_DEPTH) throw new FormatError('Huffman tree is too deep');
  const { entries } = context;
  if (reader.bit()) {
    const branch = entries.length;
    entries.push(0);
    readWordTreeNode(reader, context, depth + 1);
    entries[branch] = -entries.length;
    readWordTreeNode(reader, context, depth + 1);
    return;
  }
  const value = decodeTable(context.low, reader) | (decodeTable(context.high, reader) << BYTE_BITS);
  const slot = context.escapes.indexOf(value);
  if (slot >= 0) context.escapeLeaves[slot] = entries.length;
  entries.push(slot >= 0 ? 0 : value);
}

function readWordTree(reader: BitReader): WordTree {
  if (!reader.bit()) return { table: ABSENT_TREE };
  const low = readByteTree(reader);
  const high = readByteTree(reader);
  const escapes = [reader.bits(WORD_BITS), reader.bits(WORD_BITS), reader.bits(WORD_BITS)];
  const context: WordTreeContext = { low, high, escapes, escapeLeaves: [-1, -1, -1], entries: [] };
  readWordTreeNode(reader, context, 0);
  reader.bit();
  const table = Int32Array.from(context.entries);
  context.escapeLeaves.forEach((leaf, slot) => {
    if (leaf >= 0) table[leaf] = ESCAPE_LEAF + slot;
  });
  return { table };
}

class WordDecoder {
  readonly #table: Int32Array;
  readonly #recent = new Int32Array(SMK_ESCAPE_SLOTS);

  constructor(tree: WordTree) {
    this.#table = tree.table;
  }

  reset(): void {
    this.#recent.fill(0);
  }

  decode(reader: BitReader): number {
    const recent = this.#recent;
    const leaf = decodeTable(this.#table, reader);
    const value = leaf >= ESCAPE_LEAF ? (recent[leaf - ESCAPE_LEAF] as number) : leaf;
    if (value !== recent[0]) {
      recent[2] = recent[1] as number;
      recent[1] = recent[0] as number;
      recent[0] = value;
    }
    return value;
  }
}

function signature(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
}

function readAudioTracks(view: DataView): SmkAudioTrack[] {
  const tracks: SmkAudioTrack[] = [];
  for (let track = 0; track < SMK_MAX_AUDIO_TRACKS; track++) {
    const rate = view.getUint32(72 + track * 4, true);
    if (!(rate & SmkAudioFlag.PRESENT)) continue;
    if (rate & SmkAudioFlag.BINK) throw new FormatError(`audio track ${track} uses Bink audio, which Smacker 2 files never do`);
    tracks.push({
      track,
      sampleRate: rate & SmkAudioFlag.RATE,
      channels: rate & SmkAudioFlag.STEREO ? 2 : 1,
      bitsPerSample: rate & SmkAudioFlag.SIXTEEN_BIT ? 16 : 8,
      compressed: (rate & SmkAudioFlag.COMPRESSED) !== 0,
    });
  }
  return tracks;
}

function checkFlags(flags: number): void {
  if (flags & SmkFlag.RING_FRAME) throw new FormatError('ring frames are not supported (no game video uses them)');
  if (flags & (SmkFlag.Y_INTERLACED | SmkFlag.Y_DOUBLED)) {
    throw new FormatError('Y-interlaced and Y-doubled videos are not supported (no game video uses them)');
  }
}

export function openSmk(bytes: Uint8Array): SmkVideo {
  if (bytes.length < SMK_HEADER_BYTES) throw new FormatError('file is too short for a Smacker header');
  const tag = signature(bytes);
  if (tag !== SMK_SIGNATURE) {
    throw new FormatError(tag === 'SMK4' ? 'Smacker 4 files are not supported (the game videos are SMK2)' : 'not a Smacker file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const frameCount = view.getUint32(12, true);
  const flags = view.getUint32(20, true);
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new FormatError(`bad video size ${width}x${height}`);
  }
  checkFlags(flags);
  const treesSize = view.getUint32(52, true);
  const audioTracks = readAudioTracks(view);
  const sizesAt = SMK_HEADER_BYTES;
  const typesAt = sizesAt + frameCount * 4;
  const treesAt = typesAt + frameCount;
  let offset = treesAt + treesSize;
  if (offset > bytes.length) throw new FormatError('frame table or Huffman trees run past the end of the file');
  const frames: SmkFrameEntry[] = [];
  for (let i = 0; i < frameCount; i++) {
    const raw = view.getUint32(sizesAt + i * 4, true);
    const size = raw & ~SMK_FRAME_SIZE_FLAGS;
    const type = bytes[typesAt + i] as number;
    if (offset + size > bytes.length) throw new FormatError(`frame ${i} runs past the end of the file`);
    frames.push({
      offset,
      size,
      keyframe: (raw & 1) !== 0,
      hasPalette: (type & SmkFrameType.PALETTE) !== 0,
      audioTracks: type >> 1,
    });
    offset += size;
  }
  const reader = new BitReader(bytes, treesAt, treesAt + treesSize, 'Huffman tree block');
  const trees: VideoTrees = {
    monoMap: readWordTree(reader),
    monoColours: readWordTree(reader),
    full: readWordTree(reader),
    type: readWordTree(reader),
  };
  return {
    width,
    height,
    frameCount,
    microsPerFrame: microsPerFrameOf(view.getInt32(16, true)),
    flags,
    audioTracks,
    frames,
    bytes,
    trees,
  };
}

interface AudioChunk {
  readonly track: number;
  readonly start: number;
  readonly end: number;
}

interface FrameLayout {
  readonly paletteStart: number;
  readonly paletteEnd: number;
  readonly audio: readonly AudioChunk[];
  readonly videoStart: number;
  readonly videoEnd: number;
}

function frameLayout(video: SmkVideo, index: number): FrameLayout {
  const entry = video.frames[index];
  if (!entry) throw new RangeError(`no frame ${index}`);
  const { bytes } = video;
  const end = entry.offset + entry.size;
  let at = entry.offset;
  let paletteStart = at;
  let paletteEnd = at;
  if (entry.hasPalette) {
    const length = (bytes[at] ?? 0) * SMK_PALETTE_CHUNK_UNIT;
    if (length === 0 || at + length > end) throw new FormatError(`frame ${index}: bad palette chunk`);
    paletteStart = at + 1;
    paletteEnd = at + length;
    at += length;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const audio: AudioChunk[] = [];
  for (let track = 0; track < SMK_MAX_AUDIO_TRACKS; track++) {
    if (!(entry.audioTracks & (1 << track))) continue;
    if (at + SMK_AUDIO_SIZE_BYTES > end) throw new FormatError(`frame ${index}: audio chunk header runs past the frame`);
    const length = view.getUint32(at, true);
    if (length < SMK_AUDIO_SIZE_BYTES || at + length > end) throw new FormatError(`frame ${index}: bad audio chunk of track ${track}`);
    audio.push({ track, start: at + SMK_AUDIO_SIZE_BYTES, end: at + length });
    at += length;
  }
  return { paletteStart, paletteEnd, audio, videoStart: at, videoEnd: end };
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16) | ((bytes[at + 3] as number) << 24)) >>> 0
  );
}

function chunkSampleCount(bytes: Uint8Array, chunk: AudioChunk, track: SmkAudioTrack): number {
  const bytesPerSample = track.bitsPerSample / BYTE_BITS;
  if (!track.compressed) return Math.floor((chunk.end - chunk.start) / bytesPerSample / track.channels);
  if (chunk.end - chunk.start < SMK_AUDIO_SIZE_BYTES) throw new FormatError('compressed audio chunk is too short');
  const unpacked = readUint32(bytes, chunk.start);
  if (unpacked > MAX_AUDIO_CHUNK_BYTES) throw new FormatError(`audio chunk unpacks to ${unpacked} bytes`);
  return Math.floor(unpacked / bytesPerSample / track.channels);
}

function pcm8ToInt16(sample: number): number {
  return ((sample & BYTE_MASK) - PCM_8_BIAS) << PCM_8_SHIFT;
}

function copyRawAudio(bytes: Uint8Array, chunk: AudioChunk, track: SmkAudioTrack, out: Int16Array[], at: number): number {
  const frames = chunkSampleCount(bytes, chunk, track);
  const sixteen = track.bitsPerSample === 16;
  let p = chunk.start;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < track.channels; channel++) {
      const target = out[channel] as Int16Array;
      if (sixteen) {
        target[at + i] = (bytes[p] as number) | ((bytes[p + 1] as number) << 8);
        p += 2;
      } else {
        target[at + i] = pcm8ToInt16(bytes[p++] as number);
      }
    }
  }
  return frames;
}

function decodeDpcmChunk(bytes: Uint8Array, chunk: AudioChunk, track: SmkAudioTrack, out: Int16Array[], at: number): number {
  const frames = chunkSampleCount(bytes, chunk, track);
  const reader = new BitReader(bytes, chunk.start + SMK_AUDIO_SIZE_BYTES, chunk.end, 'compressed audio chunk');
  if (!reader.bit()) return 0;
  const stereo = reader.bit() === 1;
  const sixteen = reader.bit() === 1;
  if (stereo !== (track.channels === 2) || sixteen !== (track.bitsPerSample === 16)) {
    throw new FormatError(`audio chunk format does not match track ${track.track}`);
  }
  const channels = track.channels;
  const treesPerChannel = sixteen ? 2 : 1;
  const trees = Array.from({ length: channels * treesPerChannel }, () => readByteTree(reader));
  const predictors = new Int32Array(channels);
  for (let channel = channels - 1; channel >= 0; channel--) {
    predictors[channel] = sixteen ? (reader.bits(BYTE_BITS) << BYTE_BITS) | reader.bits(BYTE_BITS) : reader.bits(BYTE_BITS);
  }
  if (frames === 0) return 0;
  for (let channel = 0; channel < channels; channel++) {
    const first = predictors[channel] as number;
    (out[channel] as Int16Array)[at] = sixteen ? first : pcm8ToInt16(first);
  }
  const samples = frames * channels;
  for (let i = channels; i < samples; i++) {
    const channel = i % channels;
    const frame = at + Math.floor(i / channels);
    if (sixteen) {
      const low = decodeTable(trees[channel * 2] as Int32Array, reader);
      const high = decodeTable(trees[channel * 2 + 1] as Int32Array, reader);
      const next = ((predictors[channel] as number) + (low | (high << BYTE_BITS))) & WORD_MASK;
      predictors[channel] = next;
      (out[channel] as Int16Array)[frame] = next;
    } else {
      const delta = decodeTable(trees[channel] as Int32Array, reader);
      const next = ((predictors[channel] as number) + delta) & BYTE_MASK;
      predictors[channel] = next;
      (out[channel] as Int16Array)[frame] = pcm8ToInt16(next);
    }
  }
  return frames;
}

export function decodeAudio(video: SmkVideo, track: SmkAudioTrack): Int16Array[] {
  const chunks = video.frames.flatMap((_, index) => frameLayout(video, index).audio.filter((a) => a.track === track.track));
  const capacity = chunks.reduce((sum, chunk) => sum + chunkSampleCount(video.bytes, chunk, track), 0);
  const out = Array.from({ length: track.channels }, () => new Int16Array(capacity));
  let written = 0;
  for (const chunk of chunks) {
    written += track.compressed
      ? decodeDpcmChunk(video.bytes, chunk, track, out, written)
      : copyRawAudio(video.bytes, chunk, track, out, written);
  }
  return written === capacity ? out : out.map((channel) => channel.slice(0, written));
}

function applyPaletteChunk(bytes: Uint8Array, start: number, end: number, palette: Uint8Array): void {
  const previous = palette.slice();
  let colour = 0;
  let p = start;
  while (colour < SMK_PALETTE_COLOURS && p < end) {
    const command = bytes[p++] as number;
    if (command & SmkPaletteCommand.SKIP) {
      colour += (command & SmkPaletteCommand.SKIP_COUNT) + 1;
    } else if (command & SmkPaletteCommand.COPY) {
      const count = (command & SmkPaletteCommand.COPY_COUNT) + 1;
      const source = bytes[p++] as number;
      if (source + count > SMK_PALETTE_COLOURS) throw new FormatError('palette copy runs past the last colour');
      for (let k = 0; k < count && colour < SMK_PALETTE_COLOURS; k++, colour++) {
        palette.set(previous.subarray((source + k) * 3, (source + k) * 3 + 3), colour * 3);
      }
    } else {
      palette[colour * 3] = sixBitToEight(command & SmkPaletteCommand.COMPONENT);
      palette[colour * 3 + 1] = sixBitToEight((bytes[p++] as number) & SmkPaletteCommand.COMPONENT);
      palette[colour * 3 + 2] = sixBitToEight((bytes[p++] as number) & SmkPaletteCommand.COMPONENT);
      colour++;
    }
  }
}

export class SmkFrameReader {
  readonly video: SmkVideo;
  readonly indices: Uint8Array;
  readonly palette = new Uint8Array(SMK_PALETTE_BYTES);
  readonly #monoMap: WordDecoder;
  readonly #monoColours: WordDecoder;
  readonly #full: WordDecoder;
  readonly #type: WordDecoder;
  #next = 0;

  constructor(video: SmkVideo) {
    this.video = video;
    this.indices = new Uint8Array(video.width * video.height);
    this.#monoMap = new WordDecoder(video.trees.monoMap);
    this.#monoColours = new WordDecoder(video.trees.monoColours);
    this.#full = new WordDecoder(video.trees.full);
    this.#type = new WordDecoder(video.trees.type);
  }

  get frameIndex(): number {
    return this.#next;
  }

  get done(): boolean {
    return this.#next >= this.video.frameCount;
  }

  nextFrame(): SmkFrame | null {
    if (this.done) return null;
    const index = this.#next;
    const layout = frameLayout(this.video, index);
    const paletteChanged = layout.paletteEnd > layout.paletteStart;
    if (paletteChanged) applyPaletteChunk(this.video.bytes, layout.paletteStart, layout.paletteEnd, this.palette);
    this.#decodeBlocks(new BitReader(this.video.bytes, layout.videoStart, layout.videoEnd, `video data of frame ${index}`));
    this.#next++;
    return { index, indices: this.indices, palette: this.palette, paletteChanged };
  }

  #decodeBlocks(reader: BitReader): void {
    const type = this.#type;
    const monoMap = this.#monoMap;
    const monoColours = this.#monoColours;
    const full = this.#full;
    for (const decoder of [type, monoMap, monoColours, full]) decoder.reset();
    const { width, height } = this.video;
    const out = this.indices;
    const blocksPerRow = width >> 2;
    const blocks = blocksPerRow * (height >> 2);
    const rowStride = width;
    let block = 0;
    while (block < blocks) {
      const code = type.decode(reader);
      const kind = code & SMK_BLOCK_TYPE_MASK;
      const run = Math.min(SMK_RUN_LENGTHS[(code >> SMK_RUN_SHIFT) & SMK_RUN_MASK] as number, blocks - block);
      if (kind === SmkBlock.VOID) {
        block += run;
        continue;
      }
      for (let n = 0; n < run; n++, block++) {
        const column = block % blocksPerRow;
        const blockRow = (block - column) / blocksPerRow;
        let p = (blockRow * width + column) * SMK_BLOCK_SIZE;
        if (kind === SmkBlock.SOLID) {
          const colour = code >>> SMK_BLOCK_EXTRA_SHIFT;
          for (let row = 0; row < SMK_BLOCK_SIZE; row++, p += rowStride) out.fill(colour, p, p + SMK_BLOCK_SIZE);
        } else if (kind === SmkBlock.MONO) {
          const colours = monoColours.decode(reader);
          let map = monoMap.decode(reader);
          const high = colours >> BYTE_BITS;
          const low = colours & BYTE_MASK;
          for (let row = 0; row < SMK_BLOCK_SIZE; row++, p += rowStride, map >>= SMK_BLOCK_SIZE) {
            out[p] = map & 1 ? high : low;
            out[p + 1] = map & 2 ? high : low;
            out[p + 2] = map & 4 ? high : low;
            out[p + 3] = map & 8 ? high : low;
          }
        } else {
          for (let row = 0; row < SMK_BLOCK_SIZE; row++, p += rowStride) {
            const right = full.decode(reader);
            out[p + 2] = right & BYTE_MASK;
            out[p + 3] = right >> BYTE_BITS;
            const left = full.decode(reader);
            out[p] = left & BYTE_MASK;
            out[p + 1] = left >> BYTE_BITS;
          }
        }
      }
    }
  }
}

export function createFrameReader(video: SmkVideo): SmkFrameReader {
  return new SmkFrameReader(video);
}
