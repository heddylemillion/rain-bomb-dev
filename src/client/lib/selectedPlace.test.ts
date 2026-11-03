import { describe, expect, it } from 'vitest';
import { initialPlace, type SelectedPlace } from './selectedPlace.js';

const defaultPlace: SelectedPlace = {
  lat: 13.7563,
  lon: 100.5018,
  name: 'default',
};

describe('initial selected place', () => {
  it('prefers valid shared URL coordinates over the saved place', () => {
    const result = initialPlace(
      new URLSearchParams('lat=14.1&lon=100.7&name=shared'),
      defaultPlace,
      JSON.stringify({ lat: 13.5, lon: 100.2, name: 'saved' })
    );

    expect(result).toEqual({ lat: 14.1, lon: 100.7, name: 'shared' });
  });

  it('restores a saved place when there are no URL coordinates', () => {
    const savedPlace = { lat: 13.5, lon: 100.2, name: 'saved', address: 'address' };

    expect(initialPlace(new URLSearchParams(), defaultPlace, JSON.stringify(savedPlace))).toEqual(
      savedPlace
    );
  });

  it('falls back to the default for invalid saved coordinates or JSON', () => {
    expect(
      initialPlace(
        new URLSearchParams(),
        defaultPlace,
        JSON.stringify({ lat: 50, lon: 100, name: 'outside Thailand' })
      )
    ).toEqual(defaultPlace);
    expect(initialPlace(new URLSearchParams(), defaultPlace, '{invalid')).toEqual(defaultPlace);
  });
});
