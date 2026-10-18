// The card that opens when you tap a restaurant, cafe or bar on the map: its name, how far it is, a
// Google Maps link, and a one-tap way to plant a flag there. The link only goes to Google when tapped.
import type { CSSProperties } from 'react';
import { PLAN_EMOJI } from '../shared/protocol.ts';
import { formatDistance, type LatLng } from './geo.ts';
import { KIND_LABEL, directionsLink, mapsLink, metresTo, walkPhrase } from './meetup.ts';
import type { FoundPlace } from './places.ts';

export function PlaceCard({ place, mePos, canPlant, onPlant, onClose }: {
  place: FoundPlace;
  mePos: LatLng | null;
  /** False when the event has an organizer and I am not one. */
  canPlant: boolean;
  onPlant: () => void;
  onClose: () => void;
}) {
  const away = metresTo(mePos, place);
  return (
    <section className="sheet panel place-card" data-testid="place-card" style={{ '--c': 'var(--gold)' } as CSSProperties}>
      <header className="panel-head">
        <div className="card-head">
          <span className="card-avatar" aria-hidden="true">{PLAN_EMOJI[place.kind]}</span>
          <span className="card-who">
            <span className="card-name" data-testid="place-name">{place.name}</span>
            <span className="card-where">{KIND_LABEL[place.kind] === 'Meet up' ? 'Nearby' : `${KIND_LABEL[place.kind]} spot`}{away !== null && ` · ${formatDistance(away)} (${walkPhrase(away)})`}</span>
          </span>
        </div>
        <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <div className="controls">
        <a className="btn btn-small btn-a" data-testid="place-maps" href={mapsLink({ ...place, place: place.name })} target="_blank" rel="noopener noreferrer">📍 Google Maps</a>
        <a className="btn btn-small btn-ghost btn-a" data-testid="place-directions" href={directionsLink(place)} target="_blank" rel="noopener noreferrer">🚶 Directions</a>
        {canPlant && <button type="button" className="btn btn-small btn-ghost" data-testid="place-plant" onClick={onPlant}>🚩 Plant a flag here</button>}
      </div>
    </section>
  );
}
