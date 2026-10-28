import type { Weather } from '../world/atmosphere';

/**
 * Operation "Coast": a 40×40 km sector off the Spanish coast, all distances in metres.
 * Three quarters of it is sea; a strip of coast with a sierra runs along the east edge.
 */
export const MAP_SIZE = 40_000;

export type Side = 'blue' | 'red';

export interface Airfield {
  side: Side;
  x: number;
  y: number;
  /** Runway direction (take-off course), radians: 0 = east, π/2 = south. */
  heading: number;
  length: number;
  width: number;
  elevation: number;
  /** Apron rectangle beside the runway: offset of its centre to the right of the runway. */
  apronOffset: number;
  apronLength: number;
  apronDepth: number;
}

export const AIRFIELDS: Record<Side, Airfield> = {
  blue: {
    side: 'blue',
    x: 32_500,
    y: 33_000,
    heading: Math.PI / 2,
    length: 2_800,
    width: 50,
    elevation: 40,
    apronOffset: 220,
    apronLength: 900,
    apronDepth: 160,
  },
  red: {
    side: 'red',
    x: 32_500,
    y: 8_000,
    heading: Math.PI / 2,
    length: 2_800,
    width: 50,
    elevation: 60,
    apronOffset: -240,
    apronLength: 1_000,
    apronDepth: 200,
  },
};

/** Mountain ridge between the bases: a segment with a Gaussian width, km. */
export const RIDGE = { from: { x: 35, y: 2 }, to: { x: 37.5, y: 38 }, width: 2.2 };
/** Coastal city, km; the centre is placed relative to the coastline. */
export const CITY = { y: 20, inland: 1.2, radius: 1.6 };

export const STANDARD_WEATHER_ID = 'standard';
/** Weather of the sortie started from the menu: +25 °C at sea level (ISA + 10). */
export const MISSION_WEATHER: Weather = { temperatureOffset: 10, seaLevelPressure: 101325 };
export const WEATHER_PRESETS: Record<string, Weather> = {
  standard: { temperatureOffset: 0, seaLevelPressure: 101325 },
  hot: { temperatureOffset: 20, seaLevelPressure: 100500 },
  cold: { temperatureOffset: -35, seaLevelPressure: 103000 },
};

/** Enemy patrol: orbit centre and altitude, metres. */
export const ENEMY_PATROL = { x: 16_000, y: 21_000, altitude: 3_000, radius: 4_000 };
/** Airborne start: over the sea, at 3 km, some 12 km from the enemy patrol (a WVR merge). */
export const PLAYER_AIR_START = { x: 16_000, y: 33_000, altitude: 3_000 };
/** Distance of reliable visual/IRST detection used by AI and the player's map, metres. */
export const DETECTION_RANGE = 20_000;

/** Default PvE pilot: missiles reward getting behind the target after the merge. */
export const AI_COMBAT = {
  missileMinRange: 1200,
  missileMaxRange: 2500,
  missileContactDelay: 8,
  missileLockTime: 3.5,
  missileCooldown: 14,
  missileRearConeDegrees: 60,
  missileAimConeDegrees: 20,
};
