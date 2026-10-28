import type { Msg } from '../i18n';
import type { Vec3 } from '../world/math';

/** Things the simulation reports to the renderer and HUD. */
export type SimEvent =
  | { type: 'gun' | 'missileLaunch' | 'flare'; pos: Vec3; aircraftId: number }
  | { type: 'message'; msg: Msg; aircraftId?: number; warning?: boolean }
  | { type: 'explosion'; pos: Vec3; size: number }
  | { type: 'hit'; pos: Vec3; aircraftId: number }
  | { type: 'impact'; pos: Vec3; water: boolean }
  | { type: 'destroyed'; aircraftId: number; cause: Msg };

export type EventSink = SimEvent[];
