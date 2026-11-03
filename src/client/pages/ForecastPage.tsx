import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CloudRain, Droplets, Gauge, Thermometer, Wind } from 'lucide-react';
import { DEFAULT_INITIAL_POINT } from '../../shared/geo.js';
import { fetchHourlyForecast } from '../api/weather.js';
import { useTranslation } from '../i18n.js';

const THAILAND_BOUNDS = { minLat: 5.5, maxLat: 20.5, minLon: 97, maxLon: 106 };

function parsePoint(params: URLSearchParams, defaultName: string): {
  lat: number;
  lon: number;
  name: string;
} {
  const rawLat = params.get('lat');
  const rawLon = params.get('lon');
  if (rawLat !== null && rawLon !== null) {
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= THAILAND_BOUNDS.minLat &&
      lat <= THAILAND_BOUNDS.maxLat &&
      lon >= THAILAND_BOUNDS.minLon &&
      lon <= THAILAND_BOUNDS.maxLon
    ) {
      return { lat, lon, name: params.get('name') || defaultName };
    }
  }
  return {
    lat: DEFAULT_INITIAL_POINT.lat,
    lon: DEFAULT_INITIAL_POINT.lon,
    name: defaultName,
  };
}

function formatMetric(value: number | null, digits = 1): string {
  return value === null
    ? '—'
    : new Intl.NumberFormat('th-TH', { maximumFractionDigits: digits }).format(value);
}

export function ForecastPage(): React.ReactNode {
  const { t, language } = useTranslation();
  const [searchParams] = useSearchParams();
  const point = parsePoint(searchParams, t('defaultAreaName'));

  const forecastQuery = useQuery({
    queryKey: ['hourly-forecast', point.lat.toFixed(2), point.lon.toFixed(2)],
    queryFn: ({ signal }) => fetchHourlyForecast(point.lat, point.lon, signal),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const current = forecastQuery.data?.hourly[0];

  const formatHour = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="page-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
          RAIN BURST EARLY WARNING
        </p>
        <h1 id="page-title" className="text-lg font-bold text-slate-50 mt-1">
          {t('pageForecast')}
        </h1>
        <p className="text-sm text-slate-200 mt-0.5">{t('forecastSubtitle')}</p>
        <p className="text-xs text-slate-300 mt-1">
          {point.name} ({point.lat.toFixed(4)}, {point.lon.toFixed(4)})
        </p>
      </div>

      {forecastQuery.isPending && (
        <div className="glass-subcard rounded-2xl p-4" role="status">
          <p className="text-sm text-slate-200">{t('weatherDetailsLoading')}</p>
        </div>
      )}

      {forecastQuery.isError && (
        <div className="glass-subcard rounded-2xl p-4 flex flex-col gap-2" role="alert">
          <p className="text-sm text-slate-100">{t('weatherDetailsFailed')}</p>
          <button
            type="button"
            onClick={() => void forecastQuery.refetch()}
            className="glass-control-btn min-h-[44px] self-start rounded-xl px-4 text-xs font-semibold"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {forecastQuery.data && (
        <>
          {current && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="glass-subcard rounded-2xl p-3 flex flex-col gap-1">
                <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                  {t('forecastTemperature')}
                </span>
                <strong className="text-lg font-bold text-slate-50">
                  {formatMetric(current.temperatureC)} °C
                </strong>
              </div>

              <div className="glass-subcard rounded-2xl p-3 flex flex-col gap-1">
                <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
                  <CloudRain className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                  {t('forecastRain')}
                </span>
                <strong className="text-lg font-bold text-slate-50">
                  {formatMetric(current.precipitationMm)} {t('unitMmPerHour')}
                </strong>
              </div>

              <div className="glass-subcard rounded-2xl p-3 flex flex-col gap-1">
                <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                  {t('forecastHumidity')}
                </span>
                <strong className="text-base font-bold text-slate-50">
                  {formatMetric(current.humidityPct, 0)}% · {t('forecastRainChance')}{' '}
                  {formatMetric(current.precipitationProbabilityPct, 0)}%
                </strong>
              </div>

              <div className="glass-subcard rounded-2xl p-3 flex flex-col gap-1">
                <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                  {t('forecastWind')} / <Gauge className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
                </span>
                <strong className="text-sm font-bold text-slate-50">
                  {formatMetric(current.windSpeedKmh)} กม./ชม. ·{' '}
                  {formatMetric(current.pressureMslHpa, 1)} hPa
                </strong>
              </div>
            </div>
          )}

          <div className="glass-subcard rounded-2xl p-3.5 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/15 text-slate-200">
                  <th scope="col" className="py-1.5 pr-2">{t('forecastHourCol')}</th>
                  <th scope="col" className="py-1.5 px-1.5 text-right">{t('forecastTempCol')}</th>
                  <th scope="col" className="py-1.5 px-1.5 text-right">{t('forecastRainCol')}</th>
                  <th scope="col" className="py-1.5 px-1.5 text-right">{t('forecastPopCol')}</th>
                  <th scope="col" className="py-1.5 px-1.5 text-right">{t('forecastWindCol')}</th>
                  <th scope="col" className="py-1.5 pl-1.5 text-right">{t('forecastCapeCol')}</th>
                </tr>
              </thead>
              <tbody>
                {forecastQuery.data.hourly.map((entry) => (
                  <tr key={entry.timeISO} className="border-b border-white/5 text-slate-100">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{formatHour(entry.timeISO)}</td>
                    <td className="py-1.5 px-1.5 text-right whitespace-nowrap">
                      {formatMetric(entry.temperatureC)} °C
                    </td>
                    <td className="py-1.5 px-1.5 text-right whitespace-nowrap">
                      {formatMetric(entry.precipitationMm)}
                    </td>
                    <td className="py-1.5 px-1.5 text-right whitespace-nowrap">
                      {formatMetric(entry.precipitationProbabilityPct, 0)}%
                    </td>
                    <td className="py-1.5 px-1.5 text-right whitespace-nowrap">
                      {formatMetric(entry.windSpeedKmh)}
                    </td>
                    <td className="py-1.5 pl-1.5 text-right whitespace-nowrap">
                      {entry.capeJkg === null
                        ? '—'
                        : `${formatMetric(entry.capeJkg, 0)}${entry.capeJkg > 1000 ? ' ⚡' : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-300">
            {t('dataSource')}:{' '}
            <a
              className="underline hover:text-sky-300"
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open-Meteo Weather Forecast API
            </a>
            {' · '}
            {t('decisionSupportShort')}
          </p>
        </>
      )}
    </section>
  );
}
