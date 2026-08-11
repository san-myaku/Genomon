/**
 * 描画モジュールの公開窓口。
 * 上位層（ui / dev / game）はここからだけ import する。
 */

export { buildRenderModel, type BuildOpts } from './model.ts';
export { renderCreatureSvg, renderDebugOverlay, type RenderSvgOpts } from './creature.ts';
export { buildEggModel, type EggOpts } from './egg.ts';
export { inspectModel, inspectBatch, type InspectResult } from './inspect.ts';
export {
  applyIdleMotion,
  ensureSharedStyles,
  idleCss,
  playReaction,
  reactionForCare,
  type ReactionKind,
} from './anim.ts';
export { resolveColors, type RenderColors } from './palette.ts';
export { makeUid } from './svg.ts';
export { VIEW, GROUND_Y, CENTER_X, buildShape, faceBoxOf, type BodyShape } from './geom.ts';
