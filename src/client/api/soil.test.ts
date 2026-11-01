import { describe, expect, it } from 'vitest';
import { roundSoilCoordinates } from './soil.js';

describe('soil query coordinates', () => {
  it('rounds nearby locations to the same four-decimal query coordinates', () => {
    expect(roundSoilCoordinates(14.06471, 100.61861)).toEqual(
      roundSoilCoordinates(14.06474, 100.61864)
    );
  });

  it('normalizes rounded negative zero', () => {
    expect(roundSoilCoordinates(-0.00001, 0.00001)).toEqual({ lat: 0, lon: 0 });
  });
});
