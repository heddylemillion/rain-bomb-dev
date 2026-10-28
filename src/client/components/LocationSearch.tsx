import { useEffect, useMemo, useRef, useState } from 'react';
import type { Community, GeocodingResult } from '../../shared/contracts.js';
import { searchPlaces } from '../api/weather.js';
import { useTranslation } from '../i18n.js';
import { readStorage, writeStorage } from '../lib/storage.js';

const RECENT_KEY = 'rain-burst-recent-places';

function readRecent(): GeocodingResult[] {
  const raw = readStorage(RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GeocodingResult =>
        typeof item === 'object' &&
        item !== null &&
        typeof item['lat'] === 'number' &&
        typeof item['lon'] === 'number' &&
        typeof item['name'] === 'string' &&
        typeof item['district'] === 'string' &&
        typeof item['province'] === 'string' &&
        typeof item['displayName'] === 'string'
    ).slice(0, 5);
  } catch {
    return [];
  }
}

export function LocationSearch({
  communities,
  focusSearchRequest,
  locating,
  onOpenChange,
  onLocate,
  onSelect,
}: {
  communities: Community[];
  focusSearchRequest: number;
  locating: boolean;
  onOpenChange: (open: boolean) => void;
  onLocate: () => void;
  onSelect: (place: GeocodingResult) => void;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [recent, setRecent] = useState(readRecent);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSearchRequest > 0) inputRef.current?.focus();
  }, [focusSearchRequest]);

  useEffect(() => onOpenChange(open), [onOpenChange, open]);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return communities
      .filter((community) => !normalized ||
        community.name_th.toLocaleLowerCase().includes(normalized) ||
        community.name_en.toLocaleLowerCase().includes(normalized))
      .slice(0, 4)
      .map((community) => ({
        lat: community.lat,
        lon: community.lon,
        name: language === 'th' ? community.name_th : community.name_en,
        district: '',
        province: '',
        displayName: language === 'th' ? community.name_th : community.name_en,
      }));
  }, [communities, language, query]);
  const options = [...results, ...suggestions];

  const selectPlace = (place: GeocodingResult): void => {
    const next = [place, ...recent.filter((item) => item.displayName !== place.displayName)].slice(0, 5);
    setRecent(next);
    writeStorage(RECENT_KEY, JSON.stringify(next));
    setQuery(place.displayName);
    setOpen(false);
    setError('');
    onSelect(place);
  };

  const submit = async (): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setError(t('searchMinimum'));
      setOpen(true);
      return;
    }
    setLoading(true);
    setError('');
    setOpen(true);
    setActiveIndex(-1);
    try {
      const controller = new AbortController();
      const found = await searchPlaces(trimmed, controller.signal, language);
      setResults(found);
      if (found.length === 0) setError(t('searchNoResults'));
    } catch {
      setResults([]);
      setError(t('searchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const clearRecent = (): void => {
    setRecent([]);
    writeStorage(RECENT_KEY, '[]');
  };

  return (
    <section className="map-panel location-search" aria-label={t('searchLocation')}>
      <form
        className="location-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="location-query">{t('searchLocation')}</label>
        <input
          ref={inputRef}
          id="location-query"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="location-results"
          aria-activedescendant={activeIndex >= 0 ? `place-option-${activeIndex}` : undefined}
          placeholder={t('searchPlaceholder')}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults([]);
            setError('');
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && options.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % options.length);
            } else if (event.key === 'ArrowUp' && options.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
              event.preventDefault();
              selectPlace(options[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <button type="submit" className="search-submit" disabled={loading} aria-label={t('searchButton')} title={t('searchButton')}>
          {loading ? '…' : '⌕'}
        </button>
      </form>
      <button type="button" className="current-location-button" onClick={onLocate} disabled={locating}>
        <span aria-hidden="true">◎</span> {t('myLocation')}
      </button>
      {open && (
        <div id="location-results" className="location-results" role="listbox" aria-label={t('searchResults')}>
          {loading && <p className="search-message" role="status">{t('searchLoading')}</p>}
          {error && <p className="search-message" role="status">{error}</p>}
          {results.map((place, index) => (
            <button
              id={`place-option-${index}`}
              key={`${place.lat}:${place.lon}:${place.displayName}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className="place-option"
              onClick={() => selectPlace(place)}
            >
              <strong>{place.name}</strong>
              <span>{[place.district, place.province].filter(Boolean).join(' · ') || place.displayName}</span>
            </button>
          ))}
          {suggestions.length > 0 && (
            <>
              <p className="search-section-label">{t('pilotSuggestions')}</p>
              {suggestions.map((place, index) => {
                const optionIndex = results.length + index;
                return (
                  <button
                    id={`place-option-${optionIndex}`}
                    key={`pilot:${place.lat}:${place.lon}`}
                    type="button"
                    role="option"
                    aria-selected={activeIndex === optionIndex}
                    className="place-option"
                    onClick={() => selectPlace(place)}
                  >
                    <strong>{place.name}</strong>
                    <span>{t('pilotPlace')}</span>
                  </button>
                );
              })}
            </>
          )}
          {results.length === 0 && recent.length > 0 && (
            <>
              <div className="recent-heading">
                <span>{t('recentPlaces')}</span>
                <button type="button" onClick={clearRecent}>{t('clearHistory')}</button>
              </div>
              {recent.map((place) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="place-option"
                  key={`recent:${place.lat}:${place.lon}`}
                  onClick={() => selectPlace(place)}
                >
                  <strong>{language === 'en' && /[\u0E00-\u0E7F]/u.test(place.displayName) ? t('selectedPoint') : place.displayName}</strong>
                  <span>{t('recentPlace')}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
