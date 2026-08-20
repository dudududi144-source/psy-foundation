declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(type: string, data: Float32Array | Int32Array | Uint8Array, dims: number[])
  }
  export class InferenceSession {
    static create(path: string): Promise<InferenceSession>
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>
  }
}

declare module 'onnxruntime-node' {
  export class Tensor {
    constructor(type: string, data: Float32Array | Int32Array | Uint8Array, dims: number[])
  }
  export class InferenceSession {
    static create(path: string): Promise<InferenceSession>
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>
  }
}
