export function createContext(canvas: HTMLCanvasElement, options: WebGLContextAttributes = {}): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true, ...options });
  if (!gl) throw new Error('WebGL2 is not available in this browser');
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('cannot create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile error: ${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link error: ${log}`);
  }
  return program;
}

export function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name);
  if (loc === null) throw new Error(`uniform ${name} not found`);
  return loc;
}
