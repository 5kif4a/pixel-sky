import Phaser from 'phaser';
import './style.css';
import { AIRCRAFT, type AircraftId } from './data/aircraft';
import { MISSION_WEATHER } from './data/mission';
import { pixelSize } from './game/config';
import { applyStatic, getLang, onLangChange, setLang, t } from './i18n';
import { BattleScene } from './scenes/BattleScene';
import { HangarView } from './ui/hangar';

const $ = (id: string) => document.getElementById(id)!;
let plane: AircraftId = 'MiG-35';
let state: 'menu' | 'running' | 'paused' | 'finished' = 'menu';

const gameSize = () => ({
  width: Math.max(320, Math.floor(window.innerWidth / pixelSize())),
  height: Math.max(200, Math.floor(window.innerHeight / pixelSize())),
});

const scene = new BattleScene();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#16303f',
  pixelArt: true,
  antialias: false,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.NONE, ...gameSize() },
  scene,
  fps: { target: 60 },
});
window.addEventListener('resize', () => {
  const s = gameSize();
  game.scale.resize(s.width, s.height);
});

const hangar = new HangarView($('hangar-view') as HTMLCanvasElement, $('hangar-specs'));

function choose(container: HTMLElement, button: HTMLElement) {
  container.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === button));
}

/** Aircraft cards on the left: icon and name. */
function buildMenu() {
  const picker = $('aircraft-picker');
  picker.innerHTML = '';
  for (const spec of Object.values(AIRCRAFT)) {
    const b = document.createElement('button');
    b.className = spec.id === plane ? 'selected' : '';
    b.innerHTML =
      `<img src="${hangar.icon(spec.id)}" alt="" />` +
      `<strong>${t('aircraft.' + spec.id)}</strong>`;
    b.onclick = () => {
      plane = spec.id;
      choose(picker, b);
      hangar.show(plane);
    };
    picker.appendChild(b);
  }
}

function refreshTexts() {
  applyStatic();
  buildMenu();
  hangar.renderSpecs();
  $('lang')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => b.classList.toggle('selected', b.dataset.lang === getLang()));
  $('pause').textContent = t(state === 'paused' ? 'ui.resume' : 'ui.pause');
}
onLangChange(refreshTexts);
$('lang')
  .querySelectorAll<HTMLButtonElement>('button')
  .forEach((b) => (b.onclick = () => setLang(b.dataset.lang as 'en' | 'ru')));

scene.onState = (next) => {
  state = next;
  $('overlay').hidden = true;
  hangar.hide();
  $('hud').hidden = false;
  // In flight the HUD takes the top-left corner and the header shows only its buttons.
  document.body.classList.add('in-battle');
  $('pause').textContent = t(next === 'paused' ? 'ui.resume' : 'ui.pause');
  $('pause').hidden = next === 'finished';
};
$('start').onclick = () => {
  // Drop focus so Enter/Space in flight do not press menu buttons.
  (document.activeElement as HTMLElement | null)?.blur();
  scene.startBattle({ player: plane, start: 'air', weather: MISSION_WEATHER });
};
$('pause').onclick = () => scene.togglePause();
$('pause').hidden = true;

const volume = $('volume') as HTMLInputElement;
volume.value = String(Math.round(scene.audio.volume * 100));
volume.oninput = () => {
  scene.audio.unlock();
  scene.audio.setVolume(Number(volume.value) / 100);
};
// Keep flight shortcuts and pointer controls out of the volume control.
volume.onkeydown = (event) => event.stopPropagation();
volume.onpointerdown = (event) => event.stopPropagation();
volume.onchange = () => volume.blur();

setLang(getLang());
hangar.show(plane);

if (import.meta.env.DEV) Object.assign(window, { pixelSky: game, battleScene: scene });
