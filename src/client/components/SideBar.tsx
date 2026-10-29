import type { PropsWithChildren, ReactNode } from 'react';
import { useTranslation } from '../i18n.js';
import type { MapLayerId } from './MapOverlays.js';

export type SideTopicState = 'on' | 'off' | 'unavailable';

export interface SideTopic {
  id: MapLayerId;
  label: string;
  description: string;
  state: SideTopicState;
}

export interface SideBarPlace {
  lat: number;
  lon: number;
  name: string;
  address?: string | undefined;
}

interface SideBarProps {
  open: boolean;
  onToggle: () => void;
  topics: SideTopic[];
  onToggleTopic: (id: MapLayerId) => void;
  place: SideBarPlace | null;
  /** Rendered at the top of the panel, above the topic list. */
  search?: ReactNode;
}

export function SideBar({
  open,
  onToggle,
  topics,
  onToggleTopic,
  place,
  search,
  children,
}: PropsWithChildren<SideBarProps>): React.ReactNode {
  const { t } = useTranslation();
  const toggleLabel = open ? t('sideHide') : t('sideShow');
  const statusText = (state: SideTopicState): string =>
    state === 'on' ? t('topicOn') : state === 'off' ? t('topicOff') : t('topicUnavailable');

  return (
    <aside
      id="map-side-bar"
      className={`side-bar${open ? ' is-open' : ' is-closed'}`}
      aria-label={t('sideTitle')}
    >
      <button
        type="button"
        className="side-bar-toggle"
        aria-expanded={open}
        aria-controls="map-side-bar-body"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggle}
      >
        <span aria-hidden="true">{open ? '‹' : '›'}</span>
      </button>
      {/* Kept mounted (hidden) so the risk card keeps its state while collapsed. */}
      <div id="map-side-bar-body" className="side-bar-body" hidden={!open}>
        <h2 className="side-bar-title">{t('sideTitle')}</h2>

        {search && <div className="side-bar-search">{search}</div>}

        <section className="side-section" aria-labelledby="side-address-heading">
          <h3 id="side-address-heading" className="side-heading">{t('sideAddress')}</h3>
          {place ? (
            <div className="side-address">
              {place.address ? (
                <p className="side-address-text">{place.address}</p>
              ) : (
                <>
                  <p className="side-address-text">{place.name}</p>
                  <p className="side-note">{t('sideAddressUnavailable')}</p>
                </>
              )}
              <p className="side-coordinates">
                {t('sideCoordinates')}: {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
              </p>
            </div>
          ) : (
            <p className="side-note">{t('sidePickHint')}</p>
          )}
        </section>

        <nav className="side-section" aria-labelledby="side-topics-heading">
          <h3 id="side-topics-heading" className="side-heading">{t('sideTopics')}</h3>
          <ul className="side-topic-list">
            {topics.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  className={`side-topic is-${topic.state}`}
                  aria-pressed={topic.state === 'on'}
                  disabled={topic.state === 'unavailable'}
                  onClick={() => onToggleTopic(topic.id)}
                >
                  <span className="side-topic-head">
                    <span className="side-topic-label">{topic.label}</span>
                    <span className="side-topic-status">{statusText(topic.state)}</span>
                  </span>
                  <span className="side-topic-desc">{topic.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {children}
      </div>
    </aside>
  );
}
