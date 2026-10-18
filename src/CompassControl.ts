// A big, obvious compass for the map. Its needle always points at real north; tapping it turns the map
// north-up, and once the map is already north-up, taps flatten it to a plain top-down view and back to the tilted 3D one.
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';

const TILTED = 45;

const ROSE = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
  <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3"/>
  <path d="M20 4 L26 20 L14 20 Z" fill="#e8453c" stroke="#2b1d12" stroke-width="2" stroke-linejoin="round"/>
  <path d="M20 36 L26 20 L14 20 Z" fill="#fff6ea" stroke="#2b1d12" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

export class CompassControl implements IControl {
  private map: MapLibreMap | undefined;
  private box: HTMLDivElement | undefined;
  private button: HTMLButtonElement | undefined;
  private rose: HTMLSpanElement | undefined;
  private readonly sync = () => this.update();

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const box = document.createElement('div');
    box.className = 'maplibregl-ctrl compass-ctrl';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compass-btn';
    button.dataset.testid = 'btn-north';
    button.innerHTML = `<span class="compass-n" aria-hidden="true">N</span><span class="compass-rose">${ROSE}</span>`;
    button.addEventListener('click', () => this.tap());
    box.append(button);
    this.box = box;
    this.button = button;
    this.rose = button.querySelector('.compass-rose') as HTMLSpanElement;
    map.on('rotate', this.sync);
    map.on('pitch', this.sync);
    this.update();
    return box;
  }

  onRemove(): void {
    this.map?.off('rotate', this.sync);
    this.map?.off('pitch', this.sync);
    this.box?.remove();
    this.map = this.box = this.button = this.rose = undefined;
  }

  private turned() {
    const b = this.map ? ((this.map.getBearing() % 360) + 540) % 360 - 180 : 0; // -180..180
    return Math.abs(b) > 0.5;
  }

  private tap() {
    const map = this.map;
    if (!map) return;
    if (this.turned()) map.easeTo({ bearing: 0, duration: 600 });
    else if (map.getPitch() > 1) map.easeTo({ pitch: 0, duration: 600 });
    else map.easeTo({ pitch: TILTED, duration: 600 });
  }

  private update() {
    const map = this.map;
    if (!map || !this.button || !this.rose) return;
    const bearing = map.getBearing();
    const turned = this.turned();
    this.rose.style.transform = `rotate(${-bearing}deg)`; // the needle stays on real north
    this.button.classList.toggle('is-turned', turned);
    this.button.dataset.bearing = String(Math.round(bearing));
    this.button.dataset.pitch = String(Math.round(map.getPitch()));
    const label = turned ? 'Point the map north' : map.getPitch() > 1 ? 'Flatten the map' : 'Tilt the map';
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
  }
}
