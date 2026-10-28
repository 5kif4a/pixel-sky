/**
 * Size of one game pixel in screen pixels: the scene renders at reduced resolution. Grows
 * with the window so the world is not tiny on large monitors (3 at 1440p, 2 at 1080p).
 */
export const pixelSize = () => Math.max(2, Math.round(window.innerHeight / 480));
/** Fixed simulation step, s. */
export const SIM_STEP = 1 / 60;
/** Longest stretch of time the simulation catches up after a slow frame, s. */
export const MAX_CATCH_UP = 0.1;
