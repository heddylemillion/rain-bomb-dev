import pino from 'pino';
import { appConfig } from './config.js';

export function redactSecretsInText(input: string): string {
  if (!input) return input;
  return input.replace(/(?:api[_-]?key|apikey)=[^&\s"']+/gi, 'api_key=***REDACTED***');
}

export const logger = pino({
  level: appConfig.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.query.apikey',
      'apikey',
      'apiKey',
    ],
    censor: '***REDACTED***',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
