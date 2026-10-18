import { BinaryWriter } from '../src/content/binary/writer.ts';
import {
  SMK_AUDIO_SIZE_BYTES,
  SMK_BLOCK_EXTRA_SHIFT,
  SMK_BLOCK_SIZE,
  SMK_ESCAPE_SLOTS,
  SMK_HEADER_BYTES,
  SMK_MAX_AUDIO_TRACKS,
  SMK_PALETTE_BYTES,
  SMK_PALETTE_CHUNK_UNIT,
  SMK_PALETTE_COLOURS,
  SMK_RUN_LENGTHS,
  SMK_RUN_SHIFT,
  SMK_SIGNATURE,
  SmkAudioFlag,
  SmkBlock,
  SmkFrameType,
  SmkPaletteCommand,
} from '../src/content/formats/smk.ts';

export interface SmkEncodeFrame {
  readonly indices: Uint8Array;
  readonly palette?: Uint8Array;
}

export interface SmkEncodeAudio {
  readonly sampleRate: number;
  readonly bitsPerSample: 8 | 16;
  readonly compressed: boolean;
  readonly channels: readonly Int16Array[];
}

export interface SmkEncodeInput {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frames: readonly SmkEncodeFrame[];
  readonly audio?: SmkEncodeAudio;
  readonly flags?: number;
  readonly useEscapes?: boolean;
}

export type SmkBlockCounts = Record<'mono' | 'full' | 'void' | 'solid', number>;

export interface SmkEncoded {
  readonly bytes: Uint8Array;
  readonly blocks: SmkBlockCounts;
  readonly escapesUsed: number;
}

const BYTE_BITS = 8;
const WORD_BITS = 16;
const BYTE_MASK = 0xff;
const WORD_MASK = 0xffff;
const WORD_VALUES = 0x10000;
const MAX_CODE_LENGTH = 30;
const SIX_BIT_SHIFT = 2;
const PCM_8_BIAS = 128;
const MIN_COPY_RUN = 2;
const MAX_COPY_RUN = SmkPaletteCommand.COPY_COUNT + 1;
const MAX_SKIP_RUN = SmkPaletteCommand.SKIP_COUNT + 1;
const MICROS_PER_SECOND = 1_000_000;
const TREE_TABLE_ENTRY_BYTES = 4;
const BLOCK_PIXELS = SMK_BLOCK_SIZE * SMK_BLOCK_SIZE;
const MICROS_PER_MILLI = 1000;
const MICROS_PER_NEGATIVE_RATE_UNIT = 10;

class BitWriter {
  readonly #bytes: number[] = [];
  #current = 0;
  #count = 0;

  bit(value: number): void {
    this.#current |= (value & 1) << this.#count;
    if (++this.#count === BYTE_BITS) {
      this.#bytes.push(this.#current);
      this.#current = 0;
      this.#count = 0;
    }
  }

  bits(value: number, count: number): void {
    for (let i = 0; i < count; i++) this.bit((value >>> i) & 1);
  }

  code(code: Code): void {
    this.bits(code.bits, code.length);
  }

  finish(): Uint8Array {
    const out = Uint8Array.from(this.#bytes);
    return this.#count > 0 ? Uint8Array.of(...out, this.#current) : out;
  }
}

interface Code {
  readonly bits: number;
  readonly length: number;
}

interface HuffLeaf {
  readonly symbol: number;
}

interface HuffBranch {
  readonly zero: HuffNode;
  readonly one: HuffNode;
}

type HuffNode = HuffLeaf | HuffBranch;

function isLeaf(node: HuffNode): node is HuffLeaf {
  return 'symbol' in node;
}

function buildHuffman(frequencies: ReadonlyMap<number, number>): HuffNode | null {
  const queue = [...frequencies.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([symbol, weight], order) => ({ node: { symbol } as HuffNode, weight, order }));
  if (queue.length === 0) return null;
  let order = queue.length;
  while (queue.length > 1) {
    queue.sort((a, b) => a.weight - b.weight || a.order - b.order);
    const [zero, one] = queue.splice(0, 2);
    if (!zero || !one) break;
    queue.push({ node: { zero: zero.node, one: one.node }, weight: zero.weight + one.weight, order: order++ });
  }
  return queue[0]?.node ?? null;
}

function codesOf(root: HuffNode | null): Map<number, Code> {
  const codes = new Map<number, Code>();
  const visit = (node: HuffNode, bits: number, length: number): void => {
    if (length > MAX_CODE_LENGTH) throw new RangeError('Huffman code too long for the stub encoder');
    if (isLeaf(node)) {
      codes.set(node.symbol, { bits, length });
      return;
    }
    visit(node.zero, bits, length + 1);
    visit(node.one, bits | (1 << length), length + 1);
  };
  if (root) visit(root, 0, 0);
  return codes;
}

function countNodes(root: HuffNode | null): number {
  if (!root) return 0;
  return isLeaf(root) ? 1 : 1 + countNodes(root.zero) + countNodes(root.one);
}

function count<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

class ByteTree {
  readonly root: HuffNode | null;
  readonly codes: Map<number, Code>;

  constructor(frequencies: ReadonlyMap<number, number>) {
    this.root = buildHuffman(frequencies);
    this.codes = codesOf(this.root);
  }

  write(out: BitWriter): void {
    if (!this.root) {
      out.bit(0);
      return;
    }
    out.bit(1);
    const visit = (node: HuffNode): void => {
      if (isLeaf(node)) {
        out.bit(0);
        out.bits(node.symbol, BYTE_BITS);
        return;
      }
      out.bit(1);
      visit(node.zero);
      visit(node.one);
    };
    visit(this.root);
    out.bit(0);
  }

  emit(out: BitWriter, symbol: number): void {
    const code = this.codes.get(symbol);
    if (!code) throw new RangeError(`byte ${symbol} is not in the tree`);
    out.code(code);
  }
}

const ESCAPE_SYMBOL = WORD_VALUES;

class WordTreeBuilder {
  readonly #useEscapes: boolean;
  readonly #recent = [0, 0, 0];
  readonly frequencies = new Map<number, number>();
  escapesUsed = 0;

  constructor(useEscapes: boolean) {
    this.#useEscapes = useEscapes;
  }

  reset(): void {
    this.#recent.fill(0);
  }

  choose(value: number): number {
    const recent = this.#recent;
    const slot = this.#useEscapes ? recent.indexOf(value) : -1;
    if (value !== recent[0]) {
      recent[2] = recent[1] ?? 0;
      recent[1] = recent[0] ?? 0;
      recent[0] = value;
    }
    return slot >= 0 ? ESCAPE_SYMBOL + slot : value;
  }

  add(value: number): void {
    const symbol = this.choose(value);
    if (symbol >= ESCAPE_SYMBOL) this.escapesUsed++;
    count(this.frequencies, symbol);
  }
}

class WordTree {
  readonly root: HuffNode | null;
  readonly codes: Map<number, Code>;
  readonly escapes: readonly number[];
  readonly low: ByteTree;
  readonly high: ByteTree;
  readonly #chooser: WordTreeBuilder;

  constructor(builder: WordTreeBuilder, useEscapes: boolean) {
    this.root = buildHuffman(builder.frequencies);
    this.codes = codesOf(this.root);
    const regular = new Set([...builder.frequencies.keys()].filter((s) => s < ESCAPE_SYMBOL));
    const escapes: number[] = [];
    for (let v = 0; escapes.length < SMK_ESCAPE_SLOTS && v < WORD_VALUES; v++) if (!regular.has(v)) escapes.push(v);
    this.escapes = escapes;
    const lows = new Map<number, number>();
    const highs = new Map<number, number>();
    for (const symbol of builder.frequencies.keys()) {
      const value = this.#leafValue(symbol);
      count(lows, value & BYTE_MASK);
      count(highs, value >> BYTE_BITS);
    }
    this.low = new ByteTree(lows);
    this.high = new ByteTree(highs);
    this.#chooser = new WordTreeBuilder(useEscapes);
  }

  #leafValue(symbol: number): number {
    return symbol >= ESCAPE_SYMBOL ? (this.escapes[symbol - ESCAPE_SYMBOL] as number) : symbol;
  }

  get tableEntries(): number {
    return countNodes(this.root) + SMK_ESCAPE_SLOTS;
  }

  write(out: BitWriter): void {
    if (!this.root) {
      out.bit(0);
      return;
    }
    out.bit(1);
    this.low.write(out);
    this.high.write(out);
    for (const escapeValue of this.escapes) out.bits(escapeValue, WORD_BITS);
    const visit = (node: HuffNode): void => {
      if (isLeaf(node)) {
        out.bit(0);
        const value = this.#leafValue(node.symbol);
        this.low.emit(out, value & BYTE_MASK);
        this.high.emit(out, value >> BYTE_BITS);
        return;
      }
      out.bit(1);
      visit(node.zero);
      visit(node.one);
    };
    visit(this.root);
    out.bit(0);
  }

  reset(): void {
    this.#chooser.reset();
  }

  emit(out: BitWriter, value: number): void {
    const symbol = this.#chooser.choose(value);
    const code = this.codes.get(symbol);
    if (!code) throw new RangeError(`value ${value} is not in the tree`);
    out.code(code);
  }
}

type TreeName = 'monoMap' | 'monoColours' | 'full' | 'type';
const TREE_ORDER: readonly TreeName[] = ['monoMap', 'monoColours', 'full', 'type'];

interface Token {
  readonly tree: TreeName;
  readonly value: number;
}

function blockPixels(indices: Uint8Array, width: number, block: number, blocksPerRow: number): Uint8Array {
  const column = block % blocksPerRow;
  const row = (block - column) / blocksPerRow;
  const out = new Uint8Array(BLOCK_PIXELS);
  for (let y = 0; y < SMK_BLOCK_SIZE; y++) {
    const at = (row * SMK_BLOCK_SIZE + y) * width + column * SMK_BLOCK_SIZE;
    out.set(indices.subarray(at, at + SMK_BLOCK_SIZE), y * SMK_BLOCK_SIZE);
  }
  return out;
}

interface BlockChoice {
  readonly kind: SmkBlock;
  readonly extra: number;
  readonly tokens: readonly Token[];
}

function sameBlock(a: Uint8Array, b: Uint8Array): boolean {
  return a.every((v, i) => v === b[i]);
}

function chooseBlock(pixels: Uint8Array, previous: Uint8Array): BlockChoice {
  if (sameBlock(pixels, previous)) return { kind: SmkBlock.VOID, extra: 0, tokens: [] };
  const colours = [...new Set(pixels)].sort((a, b) => a - b);
  if (colours.length === 1) return { kind: SmkBlock.SOLID, extra: colours[0] ?? 0, tokens: [] };
  if (colours.length === 2) {
    const low = colours[0] ?? 0;
    const high = colours[1] ?? 0;
    let map = 0;
    pixels.forEach((p, i) => {
      if (p === high) map |= 1 << i;
    });
    return {
      kind: SmkBlock.MONO,
      extra: 0,
      tokens: [
        { tree: 'monoColours', value: low | (high << BYTE_BITS) },
        { tree: 'monoMap', value: map },
      ],
    };
  }
  const tokens: Token[] = [];
  for (let row = 0; row < SMK_BLOCK_SIZE; row++) {
    const p = row * SMK_BLOCK_SIZE;
    tokens.push({ tree: 'full', value: (pixels[p + 2] ?? 0) | ((pixels[p + 3] ?? 0) << BYTE_BITS) });
    tokens.push({ tree: 'full', value: (pixels[p] ?? 0) | ((pixels[p + 1] ?? 0) << BYTE_BITS) });
  }
  return { kind: SmkBlock.FULL, extra: 0, tokens };
}

function longestRunIndex(remaining: number): number {
  let best = 0;
  SMK_RUN_LENGTHS.forEach((length, i) => {
    if (length <= remaining) best = i;
  });
  return best;
}

const BLOCK_NAMES: Readonly<Record<SmkBlock, keyof SmkBlockCounts>> = {
  [SmkBlock.MONO]: 'mono',
  [SmkBlock.FULL]: 'full',
  [SmkBlock.VOID]: 'void',
  [SmkBlock.SOLID]: 'solid',
};

function frameTokens(input: SmkEncodeInput, current: Uint8Array, previous: Uint8Array, counts: SmkBlockCounts): Token[] {
  const blocksPerRow = input.width >> 2;
  const blocks = blocksPerRow * (input.height >> 2);
  const choices = Array.from({ length: blocks }, (_, b) =>
    chooseBlock(blockPixels(current, input.width, b, blocksPerRow), blockPixels(previous, input.width, b, blocksPerRow)),
  );
  const tokens: Token[] = [];
  let block = 0;
  while (block < blocks) {
    const first = choices[block] as BlockChoice;
    let end = block + 1;
    while (end < blocks && choices[end]?.kind === first.kind && choices[end]?.extra === first.extra) end++;
    while (block < end) {
      const runIndex = longestRunIndex(end - block);
      const run = SMK_RUN_LENGTHS[runIndex] as number;
      tokens.push({ tree: 'type', value: first.kind | (runIndex << SMK_RUN_SHIFT) | (first.extra << SMK_BLOCK_EXTRA_SHIFT) });
      for (let k = 0; k < run; k++) tokens.push(...(choices[block + k] as BlockChoice).tokens);
      counts[BLOCK_NAMES[first.kind]] += run;
      block += run;
    }
  }
  return tokens;
}

function quantize(palette: Uint8Array): Uint8Array {
  return palette.map((v) => v >> SIX_BIT_SHIFT);
}

function sameColour(a: Uint8Array, i: number, b: Uint8Array, j: number): boolean {
  return a[i * 3] === b[j * 3] && a[i * 3 + 1] === b[j * 3 + 1] && a[i * 3 + 2] === b[j * 3 + 2];
}

function longestCopy(previous: Uint8Array, next: Uint8Array, at: number): { source: number; length: number } {
  let best = { source: 0, length: 0 };
  for (let source = 0; source < SMK_PALETTE_COLOURS; source++) {
    let length = 0;
    while (
      length < MAX_COPY_RUN &&
      at + length < SMK_PALETTE_COLOURS &&
      source + length < SMK_PALETTE_COLOURS &&
      sameColour(previous, source + length, next, at + length)
    ) {
      length++;
    }
    if (length > best.length) best = { source, length };
  }
  return best;
}

export function encodePaletteChunk(previous6: Uint8Array, next6: Uint8Array): Uint8Array {
  const commands: number[] = [];
  let colour = 0;
  while (colour < SMK_PALETTE_COLOURS) {
    let same = 0;
    while (same < MAX_SKIP_RUN && colour + same < SMK_PALETTE_COLOURS && sameColour(previous6, colour + same, next6, colour + same)) same++;
    if (same > 0) {
      commands.push(SmkPaletteCommand.SKIP | (same - 1));
      colour += same;
      continue;
    }
    const copy = longestCopy(previous6, next6, colour);
    if (copy.length >= MIN_COPY_RUN) {
      commands.push(SmkPaletteCommand.COPY | (copy.length - 1), copy.source);
      colour += copy.length;
      continue;
    }
    commands.push(next6[colour * 3] ?? 0, next6[colour * 3 + 1] ?? 0, next6[colour * 3 + 2] ?? 0);
    colour++;
  }
  const length = Math.ceil((commands.length + 1) / SMK_PALETTE_CHUNK_UNIT) * SMK_PALETTE_CHUNK_UNIT;
  const chunk = new Uint8Array(length);
  chunk[0] = length / SMK_PALETTE_CHUNK_UNIT;
  chunk.set(commands, 1);
  return chunk;
}

function sampleRanges(input: SmkEncodeInput, total: number): [number, number][] {
  const micros = microsPerFrame(input.frameRate);
  const rate = input.audio?.sampleRate ?? 0;
  return input.frames.map((_, i) => {
    const start = Math.min(total, Math.round((i * micros * rate) / MICROS_PER_SECOND));
    const end = i === input.frames.length - 1 ? total : Math.min(total, Math.round(((i + 1) * micros * rate) / MICROS_PER_SECOND));
    return [start, end];
  });
}

function microsPerFrame(frameRate: number): number {
  if (frameRate > 0) return frameRate * MICROS_PER_MILLI;
  if (frameRate < 0) return -frameRate * MICROS_PER_NEGATIVE_RATE_UNIT;
  return MICROS_PER_SECOND / 10;
}

function storedSample(sample: number, sixteen: boolean): number {
  return sixteen ? sample & WORD_MASK : ((sample >> BYTE_BITS) + PCM_8_BIAS) & BYTE_MASK;
}

function encodeRawAudio(audio: SmkEncodeAudio, start: number, end: number): Uint8Array {
  const sixteen = audio.bitsPerSample === 16;
  const out = new BinaryWriter();
  for (let i = start; i < end; i++) {
    for (const channel of audio.channels) {
      const stored = storedSample(channel[i] ?? 0, sixteen);
      if (sixteen) out.u16(stored);
      else out.u8(stored);
    }
  }
  return out.toBytes();
}

function encodeDpcmAudio(audio: SmkEncodeAudio, start: number, end: number): Uint8Array {
  const sixteen = audio.bitsPerSample === 16;
  const channels = audio.channels.length;
  const mask = sixteen ? WORD_MASK : BYTE_MASK;
  const frames = end - start;
  const stored = audio.channels.map((c) => Array.from({ length: frames }, (_, i) => storedSample(c[start + i] ?? 0, sixteen)));
  const deltas: number[][] = stored.map((samples) => samples.slice(1).map((s, i) => (s - (samples[i] ?? 0)) & mask));
  const treesPerChannel = sixteen ? 2 : 1;
  const trees = stored.flatMap((_, channel) =>
    Array.from({ length: treesPerChannel }, (_, part) => {
      const frequencies = new Map<number, number>();
      for (const d of deltas[channel] ?? []) count(frequencies, part === 0 ? d & BYTE_MASK : d >> BYTE_BITS);
      return new ByteTree(frequencies);
    }),
  );
  const bits = new BitWriter();
  bits.bit(1);
  bits.bit(channels === 2 ? 1 : 0);
  bits.bit(sixteen ? 1 : 0);
  for (const tree of trees) tree.write(bits);
  for (let channel = channels - 1; channel >= 0; channel--) {
    const first = stored[channel]?.[0] ?? 0;
    if (sixteen) {
      bits.bits(first >> BYTE_BITS, BYTE_BITS);
      bits.bits(first & BYTE_MASK, BYTE_BITS);
    } else {
      bits.bits(first, BYTE_BITS);
    }
  }
  for (let frame = 1; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const delta = deltas[channel]?.[frame - 1] ?? 0;
      if (sixteen) {
        trees[channel * 2]?.emit(bits, delta & BYTE_MASK);
        trees[channel * 2 + 1]?.emit(bits, delta >> BYTE_BITS);
      } else {
        trees[channel]?.emit(bits, delta);
      }
    }
  }
  const unpacked = frames * channels * (audio.bitsPerSample / BYTE_BITS);
  return new BinaryWriter().u32(unpacked).bytes(bits.finish()).toBytes();
}

function audioRateField(audio: SmkEncodeAudio): number {
  let field = SmkAudioFlag.PRESENT | audio.sampleRate;
  if (audio.compressed) field |= SmkAudioFlag.COMPRESSED;
  if (audio.bitsPerSample === 16) field |= SmkAudioFlag.SIXTEEN_BIT;
  if (audio.channels.length === 2) field |= SmkAudioFlag.STEREO;
  return field >>> 0;
}

function unpackedChunkBytes(audio: SmkEncodeAudio, start: number, end: number): number {
  return (end - start) * audio.channels.length * (audio.bitsPerSample / BYTE_BITS);
}

export function encodeSmk(input: SmkEncodeInput): SmkEncoded {
  const useEscapes = input.useEscapes ?? false;
  const pixels = input.width * input.height;
  const counts: SmkBlockCounts = { mono: 0, full: 0, void: 0, solid: 0 };
  let previous: Uint8Array = new Uint8Array(pixels);
  const tokensPerFrame = input.frames.map((frame) => {
    if (frame.indices.length !== pixels) throw new RangeError('frame size does not match the video size');
    const tokens = frameTokens(input, frame.indices, previous, counts);
    previous = frame.indices;
    return tokens;
  });
  const builders = new Map(TREE_ORDER.map((name) => [name, new WordTreeBuilder(useEscapes)]));
  for (const tokens of tokensPerFrame) {
    for (const builder of builders.values()) builder.reset();
    for (const token of tokens) builders.get(token.tree)?.add(token.value);
  }
  const trees = new Map(TREE_ORDER.map((name) => [name, new WordTree(builders.get(name) as WordTreeBuilder, useEscapes)]));
  const treeBits = new BitWriter();
  for (const name of TREE_ORDER) trees.get(name)?.write(treeBits);
  const treeBytes = treeBits.finish();

  const audio = input.audio;
  const totalSamples = audio ? Math.min(...audio.channels.map((c) => c.length)) : 0;
  const ranges = audio ? sampleRanges(input, totalSamples) : [];
  let palette6: Uint8Array = new Uint8Array(SMK_PALETTE_BYTES);
  let largestAudioChunk = 0;
  const frameBytes = input.frames.map((frame, index) => {
    const out = new BinaryWriter();
    let type = 0;
    if (frame.palette) {
      const next6 = quantize(frame.palette);
      out.bytes(encodePaletteChunk(palette6, next6));
      palette6 = next6;
      type |= SmkFrameType.PALETTE;
    }
    const [start, end] = ranges[index] ?? [0, 0];
    if (audio && end > start) {
      const chunk = audio.compressed ? encodeDpcmAudio(audio, start, end) : encodeRawAudio(audio, start, end);
      out.u32(chunk.length + SMK_AUDIO_SIZE_BYTES).bytes(chunk);
      largestAudioChunk = Math.max(largestAudioChunk, unpackedChunkBytes(audio, start, end));
      type |= SmkFrameType.FIRST_AUDIO_TRACK;
    }
    const video = new BitWriter();
    for (const tree of trees.values()) tree.reset();
    for (const token of tokensPerFrame[index] ?? []) trees.get(token.tree)?.emit(video, token.value);
    out.bytes(video.finish());
    const padding = (SMK_PALETTE_CHUNK_UNIT - (out.length % SMK_PALETTE_CHUNK_UNIT)) % SMK_PALETTE_CHUNK_UNIT;
    out.zeros(padding);
    return { type, bytes: out.toBytes() };
  });

  const file = new BinaryWriter(SMK_HEADER_BYTES + frameBytes.reduce((sum, f) => sum + f.bytes.length, treeBytes.length));
  for (const c of SMK_SIGNATURE) file.u8(c.charCodeAt(0));
  file
    .u32(input.width)
    .u32(input.height)
    .u32(input.frames.length)
    .i32(input.frameRate)
    .u32(input.flags ?? 0);
  for (let track = 0; track < SMK_MAX_AUDIO_TRACKS; track++) file.u32(track === 0 && audio ? largestAudioChunk : 0);
  file.u32(treeBytes.length);
  for (const name of TREE_ORDER) file.u32((trees.get(name)?.tableEntries ?? 0) * TREE_TABLE_ENTRY_BYTES);
  for (let track = 0; track < SMK_MAX_AUDIO_TRACKS; track++) file.u32(track === 0 && audio ? audioRateField(audio) : 0);
  file.u32(0);
  for (const frame of frameBytes) file.u32(frame.bytes.length);
  for (const frame of frameBytes) file.u8(frame.type);
  file.bytes(treeBytes);
  for (const frame of frameBytes) file.bytes(frame.bytes);
  const escapesUsed = [...builders.values()].reduce((sum, b) => sum + b.escapesUsed, 0);
  return { bytes: file.toBytes(), blocks: counts, escapesUsed };
}
