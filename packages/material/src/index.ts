// Types: 9 material payload kinds + helpers
export type {
  BassPatternPayload,
  DrumPatternPayload,
  FXGesturePayload,
  FillPayload,
  MaterialPayload,
  MotifPayload,
  PhrasePayload,
  PresetPayload,
  RhythmPayload,
  TexturePayload,
} from './types.ts'
export { payloadKind } from './types.ts'

// Material builder + library
export type { CreateMaterialOptions, MaterialMetadata, MaterialQuery } from './material.ts'
export { MaterialLibrary, createMaterial } from './material.ts'

// Factory builders + their option types
export type {
  MakeBassPatternOptions,
  MakeDrumPatternOptions,
  MakeFXGestureOptions,
  MakeFillOptions,
  MakeMotifOptions,
  MakePresetOptions,
  MakeRhythmOptions,
  MakeTextureOptions,
} from './factory.ts'
export {
  makeBassPatternMaterial,
  makeDrumPatternMaterial,
  makeFXGestureMaterial,
  makeFillMaterial,
  makeMotifMaterial,
  makePresetMaterial,
  makeRhythmMaterial,
  makeTextureMaterial,
} from './factory.ts'

// Seed corpus
export { createSeedLibrary, seedMaterialsByType } from './seed.ts'
