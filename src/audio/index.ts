/**
 * 音モジュールの公開窓口。UI はここからだけ import する。
 *
 * 鑑定完了は既存の `rare` のきらめき音を使う。音源をもう1種類増やすほどの
 * 違いではないので、UI 向けの別名 `success` だけここで吸収する。
 */

export { Synth, NOTE } from './synth.ts';
export type { ToneOpts, NoiseOpts, WaveKind } from './synth.ts';
export { Sfx } from './sfx.ts';
export type { SfxName } from './sfx.ts';

import { sfx as baseSfx, type Sfx, type SfxName } from './sfx.ts';

export type UiSfxName = SfxName | 'success';
export type UiSfx = Omit<Sfx, 'play'> & { play(name: UiSfxName): void };

const originalPlay = baseSfx.play.bind(baseSfx);
const uiSfx = baseSfx as UiSfx;
uiSfx.play = (name: UiSfxName): void => originalPlay(name === 'success' ? 'rare' : name);

export const sfx: UiSfx = uiSfx;
