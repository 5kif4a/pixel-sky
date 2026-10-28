import { G, clamp } from './math';

/** Weather of the mission: temperature deviation from ISA and sea-level pressure (QNH). */
export interface Weather {
  temperatureOffset: number;
  seaLevelPressure: number;
}
export interface Air {
  temperature: number;
  pressure: number;
  density: number;
  speedOfSound: number;
}

export const STANDARD_WEATHER: Weather = { temperatureOffset: 0, seaLevelPressure: 101325 };
export const SEA_LEVEL_DENSITY = 1.225;
const R = 287.053;
const LAPSE = 0.0065;
const T0 = 288.15;
const TROPOPAUSE = 11000;
const EXPONENT = G / (R * LAPSE);
const T_TROPOPAUSE = T0 - LAPSE * TROPOPAUSE;
const P_RATIO_TROPOPAUSE = Math.pow(1 - (LAPSE * TROPOPAUSE) / T0, EXPONENT);

/**
 * International Standard Atmosphere up to 30 km. The temperature offset shifts the whole
 * profile (hot day → thinner air), pressure follows the standard profile from QNH.
 */
export function atmosphere(altitude: number, weather: Weather = STANDARD_WEATHER): Air {
  const h = clamp(altitude, -500, 30000);
  const ratio =
    h < TROPOPAUSE
      ? Math.pow(1 - (LAPSE * h) / T0, EXPONENT)
      : P_RATIO_TROPOPAUSE * Math.exp((-G * (h - TROPOPAUSE)) / (R * T_TROPOPAUSE));
  const pressure = weather.seaLevelPressure * ratio;
  const temperature = (h < TROPOPAUSE ? T0 - LAPSE * h : T_TROPOPAUSE) + weather.temperatureOffset;
  return {
    temperature,
    pressure,
    density: pressure / (R * temperature),
    speedOfSound: Math.sqrt(1.4 * R * temperature),
  };
}
