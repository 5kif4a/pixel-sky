import { t, tr } from '../i18n';
import { type Aircraft } from '../entities/aircraft';
import { SERVICE_TIME, type Battle } from '../systems/battle';
import { damageEffects } from '../systems/damage';
import { G_TOLERANCE } from '../systems/flight';
import { groundHeight } from '../world/terrain';
import { DamageSchematic } from './damageSchematic';
import { GUNS } from '../data/weapons';

const $ = (id: string) => document.getElementById(id)!;
const set = (id: string, text: string | number) => {
  const el = $(id);
  const t = String(text);
  if (el.textContent !== t) el.textContent = t;
};
const kmh = (ms: number) => Math.round(ms * 3.6);

interface Message {
  text: string;
  warning: boolean;
  until: number;
}

export class Hud {
  private schematic = new DamageSchematic($('schematic') as HTMLCanvasElement);
  private messages: Message[] = [];
  private timer = 0;

  reset() {
    this.messages = [];
    $('messages').innerHTML = '';
    $('warnings').innerHTML = '';
  }

  message(text: string, warning = false, seconds = 4) {
    this.messages = this.messages.filter((m) => m.text !== text);
    this.messages.push({ text, warning, until: performance.now() + seconds * 1000 });
    if (this.messages.length > 4) this.messages.shift();
    this.renderMessages();
  }

  private renderMessages() {
    const now = performance.now();
    this.messages = this.messages.filter((m) => m.until > now);
    const html = this.messages
      .map((m) => `<div class="${m.warning ? 'warning' : ''}">${m.text}</div>`)
      .join('');
    const el = $('messages');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /** G effects: grey-out vignette from accumulated G stress, red for negative G. */
  vignette(p: Aircraft) {
    const stress = p.pilot.gloc > 0 ? 1 : p.pilot.stress;
    const red = p.pilot.negativeStress;
    const el = $('vignette');
    const k = Math.max(stress, red);
    el.style.opacity = String(Math.min(1, Math.max(0, (k - 0.25) / 0.7)));
    el.style.background =
      red > stress
        ? 'radial-gradient(ellipse at center, #7a000033 20%, #6a0000 85%)'
        : `radial-gradient(ellipse at center, transparent ${Math.max(0, 40 - k * 40)}%, #000 85%)`;
  }

  update(b: Battle, dt: number, assist: boolean, paused: boolean, mouseAim: boolean) {
    this.vignette(b.player);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 12;
    this.renderMessages();
    const p = b.player;
    const tm = p.telemetry;
    const s = p.spec;
    set('ias', kmh(tm.ias));
    set('altitude', Math.round(p.pos.z));
    set('load', `${p.load.toFixed(1)} / ${tm.maxLoad.toFixed(1)}`);
    set('throttle', Math.round(p.throttle * 100) + '%' + (p.afterburner ? ' ' + t('hud.ab') : ''));
    const seconds = tm.fuelFlow > 0 ? Math.max(0, Math.floor(p.fuel / tm.fuelFlow)) : 0;
    const remaining =
      p.fuel <= 0
        ? '0:00'
        : tm.fuelFlow <= 0
          ? '—'
          : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    set('endurance', `${remaining} · ${tm.fuelFlow.toFixed(2)} ${t('hud.kgPerSecond')}`);
    const fx = damageEffects(p);
    const tag = (text: string, cls = '') => `<span class="${cls}">${text}</span>`;
    const gear = !fx.gearWorks
      ? tag(t('hud.gearFail'), 'bad')
      : p.gearPos > 0.99
        ? tag(t('hud.gearDown'), 'on')
        : p.gearPos < 0.01
          ? tag(t('hud.gearUp'))
          : tag(t('hud.gear') + ' ' + Math.round(p.gearPos * 100) + '%', 'on');
    const flaps = !s.hasFlaps
      ? tag(t('hud.flapsNone'))
      : p.flapsBroken
        ? tag(t('hud.flapsTorn'), 'bad')
        : tag(t(`hud.flaps${p.flaps}`), p.flaps ? 'on' : '');
    const html = [
      gear,
      flaps,
      tag(t('hud.airbrake'), p.airbrakePos > 0.05 ? 'on' : ''),
      tag(t('hud.brakes'), p.wheelBrake ? 'on' : ''),
      tag(t('hud.assist'), assist ? 'on' : ''),
      tag(t('hud.mouseAim'), mouseAim ? 'on' : ''),
    ].join('');
    if ($('config').innerHTML !== html) $('config').innerHTML = html;

    set('gun-name', GUNS[s.gun].caliber + ' ' + t('spec.mm'));
    set('gun', fx.gunWorks ? p.gunAmmo : t('hud.fail'));
    set('missile-name', t('weapon.' + s.missile));
    set('missiles', p.missiles);
    set('flares', p.flares);
    document
      .querySelectorAll<HTMLElement>('[data-slot]')
      .forEach((el) => el.classList.toggle('active', el.dataset.slot === b.weapon));

    this.schematic.draw(p, performance.now() / 1000);

    this.warnings(b, p, paused);
    const enemies = b.aircraft.filter((a) => a.side !== p.side);
    set(
      'objectives',
      t('hud.objectives', {
        left: enemies.filter((a) => a.alive).length,
        total: enemies.length,
      }),
    );
  }

  private warnings(b: Battle, p: Aircraft, paused: boolean) {
    const tm = p.telemetry;
    const w: [string, boolean][] = [];
    if (paused) w.push([t('hud.paused'), false]);
    if (b.result === 'victory') w.push([t('hud.victory'), false]);
    if (b.result === 'defeat') w.push([t('hud.defeat', { cause: tr(p.cause) }), true]);
    if (p.alive) {
      const sink = -tm.verticalSpeed;
      if (!p.onGround && sink > 5 && tm.agl / sink < 6 && !(p.gearPos > 0.99 && tm.agl < 40))
        w.push([t('hud.pullUp'), true]);
      if (p.regime === 'spin') w.push([t('hud.spin'), true]);
      else if (p.regime === 'stall') w.push([t('hud.stall'), true]);
      else if (!p.onGround && tm.ias < tm.stallSpeed * 1.1) w.push([t('hud.lowSpeed'), false]);
      if (b.missiles.some((m) => m.target === p)) w.push([t('hud.missile'), true]);
      if (p.pilot.gloc > 0) w.push([t('hud.gloc'), true]);
      else if (p.load > G_TOLERANCE && p.pilot.stress > 0.4) w.push([t('hud.gWarning'), false]);
      if (tm.overG) w.push([t('hud.overG'), true]);
      if (tm.overspeed) w.push([t('hud.overspeed'), true]);
      if (p.modules.some((m) => m.fire > 0)) w.push([t('hud.fireWarning'), true]);
      if (p.fuel < p.spec.internalFuel * 0.15) w.push([t('hud.lowFuel'), false]);
      if (p.onGround && p.serviceTime > 0 && p.serviceTime < SERVICE_TIME)
        w.push([t('hud.service', { v: Math.round((p.serviceTime / SERVICE_TIME) * 100) }), false]);
      if (
        !p.onGround &&
        p.gearPos < 0.99 &&
        tm.agl < 150 &&
        tm.ias < 110 &&
        p.pos.z - groundHeight(p.pos.x, p.pos.y) < 150
      )
        w.push([t('hud.gearNotDown'), false]);
    }
    const html = w
      .map(([text, danger]) => `<div class="${danger ? '' : 'caution'}">${text}</div>`)
      .join('');
    if ($('warnings').innerHTML !== html) $('warnings').innerHTML = html;
  }
}
