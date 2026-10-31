import { useEffect, useMemo, useRef, useState } from 'react';
import { Droplets, Loader2, LocateFixed, Search } from 'lucide-react';
import type { Community, GeocodingResult } from '../../shared/contracts.js';
import { searchPlaces } from '../api/weather.js';
import { useTranslation } from '../i18n.js';
import { readStorage, writeStorage } from '../lib/storage.js';
import { GlassTooltip, useAccessibleTooltip } from './GlassTooltip.js';

const RECENT_KEY = 'rain-burst-recent-places';

function readRecent(): GeocodingResult[] {
  const raw = readStorage(RECENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is GeocodingResult =>
          typeof item === 'object' &&
          item !== null &&
          typeof item['lat'] === 'number' &&
          typeof item['lon'] === 'number' &&
          typeof item['name'] === 'string' &&
          typeof item['district'] === 'string' &&
          typeof item['province'] === 'string' &&
          typeof item['displayName'] === 'string'
      )
      .slice(0, 5);
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
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [recent, setRecent] = useState(readRecent);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const locateTip = useAccessibleTooltip(true);

  useEffect(() => {
    if (focusSearchRequest > 0) inputRef.current?.focus();
  }, [focusSearchRequest]);

  useEffect(() => onOpenChange(open), [onOpenChange, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return communities
      .filter(
        (community) => !normalized || community.name_th.toLocaleLowerCase().includes(normalized)
      )
      .slice(0, 4)
      .map((community) => ({
        lat: community.lat,
        lon: community.lon,
        name: community.name_th,
        district: '',
        province: '',
        displayName: community.name_th,
      }));
  }, [communities, query]);

  const options = [...results, ...suggestions];

  const selectPlace = (place: GeocodingResult): void => {
    const next = [place, ...recent.filter((item) => item.displayName !== place.displayName)].slice(
      0,
      5
    );
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
      const found = await searchPlaces(trimmed, controller.signal);
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

  const hasDropdownContent =
    loading || Boolean(error) || results.length > 0 || suggestions.length > 0 || recent.length > 0;

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 md:flex-initial pointer-events-auto"
    >
      <div
        className="glass-panel min-h-[44px] px-2.5 sm:px-3 rounded-2xl inline-flex items-center gap-1.5 shrink-0 select-none"
        aria-label={`${t('brandTitle')} — ${t('brandSubtitle')}`}
      >
        <Droplets className="w-4 h-4 text-sky-400 shrink-0" aria-hidden="true" />
        <strong className="text-xs sm:text-sm font-bold tracking-tight text-slate-50 whitespace-nowrap">
          {t('brandTitle')}
        </strong>
      </div>

      <section
        className="relative flex-1 min-w-0 md:w-[230px] lg:w-[290px]"
        aria-label={t('searchLocation')}
      >
        <div className="glass-panel rounded-2xl min-h-[44px] pl-2.5 sm:pl-3 pr-0.5 flex items-center">
          <form
            className="flex items-center flex-1 min-w-0"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor="location-query">
              {t('searchLocation')}
            </label>
            <input
              ref={inputRef}
              id="location-query"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open && hasDropdownContent}
              aria-controls="location-results"
              aria-activedescendant={
                activeIndex >= 0 ? `place-option-${activeIndex}` : undefined
              }
              placeholder={t('searchLocation')}
              value={query}
              className="w-full min-w-[60px] bg-transparent border-0 text-xs sm:text-sm text-slate-50 placeholder:text-slate-200/85 focus:outline-none py-1.5"
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
            <button
              type="submit"
              disabled={loading}
              aria-label={t('searchButton')}
              title={t('searchButton')}
              className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-slate-100 shrink-0"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </form>

          <div className="relative shrink-0 border-l border-white/10 pl-0.5">
            <button
              type="button"
              onClick={onLocate}
              disabled={locating}
              aria-label={t('myLocation')}
              {...locateTip.triggerProps}
              className="glass-icon-btn min-w-[44px] min-h-[44px] rounded-xl inline-flex items-center justify-center text-sky-300"
            >
              <LocateFixed className="w-4 h-4" aria-hidden="true" />
            </button>
            <GlassTooltip id={locateTip.tooltipId} open={locateTip.open} placement="bottom">
              {t('myLocation')}
            </GlassTooltip>
          </div>
        </div>

        {open && hasDropdownContent && (
          <div
            id="location-results"
            role="listbox"
            aria-label={t('searchResults')}
            className="glass-panel absolute left-0 top-full mt-2 w-[min(340px,calc(100vw-24px))] max-h-[52dvh] overflow-y-auto rounded-2xl p-2 z-50 flex flex-col gap-1"
          >
            {loading && (
              <p className="px-3 py-2 text-xs text-slate-200" role="status">
                {t('searchLoading')}
              </p>
            )}
            {error && (
              <p className="px-3 py-2 text-xs text-slate-100" role="status">
                {error}
              </p>
            )}
            {results.map((place, index) => (
              <button
                id={`place-option-${index}`}
                key={`${place.lat}:${place.lon}:${place.displayName}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={`glass-control-btn min-h-[44px] w-full rounded-xl px-3 py-2 text-left flex flex-col ${
                  activeIndex === index ? 'glass-control-active' : ''
                }`}
                onClick={() => selectPlace(place)}
              >
                <strong className="text-sm font-semibold text-slate-50">{place.name}</strong>
                <span className="text-xs text-slate-200">
                  {[place.district, place.province].filter(Boolean).join(' · ') || place.displayName}
                </span>
              </button>
            ))}
            {suggestions.length > 0 && (
              <>
                <p className="px-2.5 pt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sky-300">
                  {t('pilotSuggestions')}
                </p>
                {suggestions.map((place, index) => {
                  const optionIndex = results.length + index;
                  return (
                    <button
                      id={`place-option-${optionIndex}`}
                      key={`pilot:${place.lat}:${place.lon}`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === optionIndex}
                      className={`glass-control-btn min-h-[44px] w-full rounded-xl px-3 py-2 text-left flex flex-col ${
                        activeIndex === optionIndex ? 'glass-control-active' : ''
                      }`}
                      onClick={() => selectPlace(place)}
                    >
                      <strong className="text-sm font-semibold text-slate-50">{place.name}</strong>
                      <span className="text-xs text-slate-200">{t('pilotPlace')}</span>
                    </button>
                  );
                })}
              </>
            )}
            {results.length === 0 && recent.length > 0 && (
              <>
                <div className="flex items-center justify-between px-2.5 pt-1">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-200">
                    {t('recentPlaces')}
                  </span>
                  <button
                    type="button"
                    onClick={clearRecent}
                    className="min-h-[36px] px-2 text-xs font-medium text-sky-300 hover:underline"
                  >
                    {t('clearHistory')}
                  </button>
                </div>
                {recent.map((place) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="glass-control-btn min-h-[44px] w-full rounded-xl px-3 py-2 text-left flex flex-col"
                    key={`recent:${place.lat}:${place.lon}`}
                    onClick={() => selectPlace(place)}
                  >
                    <strong className="text-sm font-semibold text-slate-50">
                      {place.displayName}
                    </strong>
                    <span className="text-xs text-slate-200">{t('recentPlace')}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
