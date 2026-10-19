// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-19. See LICENSE (SFI-SCLA).
// @src src/sgp/VObject_Blitters.cc Blt16BPPBufferHatchRect and Blt16BPPBufferLooseHatchRectWithColor (8×8 patterns
// @src from the clipped top-left corner), Blt8BPPDataTo16BPPBufferOutline (index 254 in a colour or skipped),
// @src BltOutlineShadow (non-254 pixels darken), Blt8BPPDataTo16BPPBufferMonoShadowClip (0 background, 1 shadow,
// @src else foreground); src/sgp/VSurface.cc InternalShadowVideoSurfaceRect (colour modulation). See docs/28 §3.11.

export const UiMode = {
  FILL: 0,
  SHADOW: 1,
  HATCH: 2,
  LOOSE_HATCH: 3,
  INDEXED: 4,
  OUTLINE: 5,
  OUTLINE_SHADOW: 6,
  RGB: 7,
  GLYPH: 8,
} as const;
export type UiMode = (typeof UiMode)[keyof typeof UiMode];

export const OUTLINE_INDEX = 254;

export const UI_VERTEX = `#version 300 es
layout(location = 0) in vec4 a_dst;
layout(location = 1) in vec4 a_src;
layout(location = 2) in vec4 a_params;
layout(location = 3) in vec4 a_c0;
layout(location = 4) in vec4 a_c1;
layout(location = 5) in vec4 a_c2;
uniform vec2 u_viewport;
out vec2 v_src;
out vec2 v_pos;
flat out vec4 v_params;
flat out vec2 v_origin;
flat out vec4 v_c0;
flat out vec4 v_c1;
flat out vec4 v_c2;
const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
void main() {
  vec2 c = CORNERS[gl_VertexID];
  vec2 p = a_dst.xy + c * a_dst.zw;
  v_src = a_src.xy + c * a_src.zw;
  v_pos = p;
  v_origin = a_src.xy;
  v_params = a_params;
  v_c0 = a_c0;
  v_c1 = a_c1;
  v_c2 = a_c2;
  gl_Position = vec4(p / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

export const UI_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_index;
uniform sampler2D u_rgb;
uniform sampler2D u_palette;
in vec2 v_src;
in vec2 v_pos;
flat in vec4 v_params;
flat in vec2 v_origin;
flat in vec4 v_c0;
flat in vec4 v_c1;
flat in vec4 v_c2;
out vec4 o_color;
const int FILL = ${UiMode.FILL};
const int SHADOW = ${UiMode.SHADOW};
const int HATCH = ${UiMode.HATCH};
const int LOOSE_HATCH = ${UiMode.LOOSE_HATCH};
const int INDEXED = ${UiMode.INDEXED};
const int OUTLINE = ${UiMode.OUTLINE};
const int OUTLINE_SHADOW = ${UiMode.OUTLINE_SHADOW};
const int RGB = ${UiMode.RGB};
const int GLYPH = ${UiMode.GLYPH};
const uint OUTLINE_INDEX = ${OUTLINE_INDEX}u;
const uint GLYPH_BACKGROUND = 0u;
const uint GLYPH_SHADOW = 1u;
vec4 opaque(vec4 c) {
  if (c.a == 0.0) discard;
  return vec4(c.rgb, 1.0);
}
bool inPattern(int mode) {
  ivec2 p = ivec2(floor(v_pos)) - ivec2(v_origin);
  int col = p.x & 7;
  int row = p.y & 7;
  if (mode == HATCH) return ((row + col) & 1) == 0;
  return ((row & 3) == 0 && (col & 3) == 0) || ((row & 3) == 2 && (col & 3) == 2);
}
void main() {
  int mode = int(v_params.x);
  if (mode == FILL) {
    o_color = vec4(v_c0.rgb, 1.0);
    return;
  }
  if (mode == SHADOW) {
    o_color = vec4(vec3(v_params.z), 1.0);
    return;
  }
  if (mode == HATCH || mode == LOOSE_HATCH) {
    if (!inPattern(mode)) discard;
    o_color = vec4(v_c0.rgb, 1.0);
    return;
  }
  if (mode == RGB) {
    o_color = vec4(texelFetch(u_rgb, ivec2(floor(v_src)), 0).rgb, 1.0);
    return;
  }
  uint index = texelFetch(u_index, ivec2(floor(v_src)), 0).r;
  if (mode == GLYPH) {
    if (index == GLYPH_BACKGROUND) o_color = opaque(v_c2);
    else if (index == GLYPH_SHADOW) o_color = opaque(v_c1);
    else o_color = vec4(v_c0.rgb, 1.0);
    return;
  }
  if (index == 0u) discard;
  if (mode == OUTLINE_SHADOW) {
    if (index == OUTLINE_INDEX) discard;
    o_color = vec4(vec3(v_params.z), 1.0);
    return;
  }
  if (mode == OUTLINE && index == OUTLINE_INDEX) {
    o_color = opaque(v_c0);
    return;
  }
  o_color = vec4(texelFetch(u_palette, ivec2(int(index), int(v_params.y)), 0).rgb, 1.0);
}`;
