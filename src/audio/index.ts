/**
 * 音モジュールの公開窓口。UI はここからだけ import する。
 */

export { Synth, NOTE } from './synth.ts';
export type { ToneOpts, NoiseOpts, WaveKind } from './synth.ts';
export { Sfx, sfx } from './sfx.ts';
export type { SfxName } from './sfx.ts';
