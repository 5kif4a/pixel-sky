import type { Aircraft } from '../entities/aircraft';
import { addScaled, angleDiff, clamp, cross, dot, normalize, sub, type Vec3 } from '../world/math';
import { groundHeight } from '../world/terrain';

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** Perspective chase camera, continuous through vertical flight and complete loops. */
export class ChaseCamera {
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  forward: Vec3 = { x: 1, y: 0, z: 0 };
  right: Vec3 = { x: 0, y: 1, z: 0 };
  up: Vec3 = { x: 0, y: 0, z: 1 };
  width = 960;
  height = 540;
  focal = 460;
  readonly near = 1;
  private yaw = 0;
  private pitch = 0;
  private followYaw = 0;
  private followPitch = 0;
  private ready = false;
  private distance = 58;
  private returning?: { elapsed: number; yaw: number; pitch: number };
  lookYaw = 0;
  lookPitch = 0;

  reset() {
    this.ready = false;
    this.returning = undefined;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  /** Complete a short, smooth return in 180 ms, following the moving aircraft. */
  returnToChase() {
    this.returning = {
      elapsed: 0,
      yaw: angleDiff(this.followYaw, this.yaw),
      pitch: this.pitch - (this.followPitch - 0.07),
    };
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.focal = height / (2 * Math.tan(Math.PI / 6));
  }

  update(
    player: Aircraft,
    target: Aircraft | undefined,
    track: boolean,
    free: boolean,
    zoom: number,
    dt: number,
  ) {
    const blend = this.ready ? 1 - Math.exp(-dt * 6) : 1;
    if (!this.ready) {
      this.followYaw = player.heading;
      this.followPitch = player.gamma;
    }
    // Heading jumps by pi at a vertical crossing in flight-path coordinates. Choose the
    // equivalent yaw/pitch pair nearest to the previous one so a loop stays continuous.
    const candidates = [
      { yaw: player.heading, pitch: player.gamma },
      { yaw: player.heading + Math.PI, pitch: Math.PI - player.gamma },
    ];
    const cost = (p: { yaw: number; pitch: number }) =>
      angleDiff(this.followYaw, p.yaw) ** 2 + angleDiff(this.followPitch, p.pitch) ** 2;
    const follow = cost(candidates[0]) <= cost(candidates[1]) ? candidates[0] : candidates[1];
    this.followYaw += angleDiff(this.followYaw, follow.yaw);
    this.followPitch += angleDiff(this.followPitch, follow.pitch);
    if (!free) {
      this.lookYaw *= 1 - blend;
      this.lookPitch *= 1 - blend;
    }
    let yaw = this.followYaw + this.lookYaw;
    let pitch = this.followPitch - 0.07 + this.lookPitch;
    if (track && target?.alive) {
      const d = sub(target.pos, player.pos);
      yaw = Math.atan2(d.y, d.x);
      pitch = Math.atan2(d.z, Math.hypot(d.x, d.y)) - 0.04;
    }
    if (free || track) this.returning = undefined;
    if (this.returning) {
      this.returning.elapsed += dt;
      const t = clamp(this.returning.elapsed / 0.18, 0, 1);
      const remaining = 1 - t * t * (3 - 2 * t);
      this.yaw = yaw + this.returning.yaw * remaining;
      this.pitch = pitch + this.returning.pitch * remaining;
      if (t === 1) this.returning = undefined;
    } else {
      this.yaw += angleDiff(this.yaw, yaw) * blend;
      this.pitch += angleDiff(this.pitch, pitch) * blend;
    }
    const cg = Math.cos(this.pitch);
    this.forward = {
      x: Math.cos(this.yaw) * cg,
      y: Math.sin(this.yaw) * cg,
      z: Math.sin(this.pitch),
    };
    this.right = { x: -Math.sin(this.yaw), y: Math.cos(this.yaw), z: 0 };
    this.up = cross(this.forward, this.right);
    const range = target?.alive
      ? Math.hypot(
          target.pos.x - player.pos.x,
          target.pos.y - player.pos.y,
          target.pos.z - player.pos.z,
        )
      : Infinity;
    const close = clamp((2500 - range) / 2000, 0, 1);
    this.distance += ((58 - close * 10) / zoom - this.distance) * blend;
    this.pos = addScaled(player.pos, this.forward, -this.distance);
    this.pos = addScaled(this.pos, this.up, 10 / zoom);
    this.pos.z = Math.max(this.pos.z, groundHeight(this.pos.x, this.pos.y) + 3);
    this.ready = true;
  }

  cameraPoint(world: Vec3): Vec3 {
    const d = sub(world, this.pos);
    return { x: dot(d, this.right), y: dot(d, this.up), z: dot(d, this.forward) };
  }

  projectCamera(p: Vec3): ScreenPoint {
    return {
      x: this.width / 2 + (p.x * this.focal) / p.z,
      y: this.height / 2 - (p.y * this.focal) / p.z,
      depth: p.z,
    };
  }

  project(world: Vec3): ScreenPoint {
    const p = this.cameraPoint(world);
    return { ...this.projectCamera({ ...p, z: Math.max(this.near, p.z) }), depth: p.z };
  }

  ray(x: number, y: number): Vec3 {
    return normalize(
      addScaled(
        addScaled(this.forward, this.right, (x - this.width / 2) / this.focal),
        this.up,
        -(y - this.height / 2) / this.focal,
      ),
    );
  }
}
