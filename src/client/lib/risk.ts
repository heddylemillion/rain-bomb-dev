import type { RiskResult } from '../../shared/contracts.js';
import type { Language, MessageKey } from '../i18n.js';

export type RiskLevel = Exclude<RiskResult['level'], 'INSUFFICIENT'>;

/** Risk is never conveyed by colour alone: every level has a distinct shape and a word. */
export const LEVEL_SYMBOL: Record<RiskLevel, string> = {
  HIGH: '▲',
  MEDIUM: '◆',
  LOW: '●',
};

export const LEVEL_KEYS: Record<
  RiskLevel,
  { short: MessageKey; status: MessageKey; explain: MessageKey; action: MessageKey }
> = {
  HIGH: { short: 'riskHigh', status: 'statusHigh', explain: 'explainHigh', action: 'actionHigh' },
  MEDIUM: { short: 'riskMedium', status: 'statusMedium', explain: 'explainMedium', action: 'actionMedium' },
  LOW: { short: 'riskLow', status: 'statusLow', explain: 'explainLow', action: 'actionLow' },
};

const LEVEL_ORDER: Record<RiskLevel, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function worstLevel(levels: readonly RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>(
    (worst, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[worst] ? level : worst),
    'LOW'
  );
}

export function formatClock(value: string, language: Language): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(timestamp);
}
