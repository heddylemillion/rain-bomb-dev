import pino from 'pino';
import { appConfig } from './config.js';

/**
 * ปิดบัง client_id และ client_secret ใน URL หรือข้อความใดๆ ก่อนบันทึกลง log
 * เพื่อไม่ให้ credentials รั่วไหลใน log หรือ error stack
 */
export function redactSecretsInText(input: string): string {
  if (!input) return input;
  let output = input
    .replace(/client_id=[^&\s"']+/gi, 'client_id=***REDACTED***')
    .replace(/client_secret=[^&\s"']+/gi, 'client_secret=***REDACTED***');

  if (appConfig.xweather.clientId && appConfig.xweather.clientId.length > 3) {
    output = output.split(appConfig.xweather.clientId).join('***REDACTED_ID***');
  }
  if (appConfig.xweather.clientSecret && appConfig.xweather.clientSecret.length > 3) {
    output = output.split(appConfig.xweather.clientSecret).join('***REDACTED_SECRET***');
  }
  return output;
}

export const logger = pino({
  level: appConfig.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.query.client_id',
      'req.query.client_secret',
      'client_id',
      'client_secret',
      'clientId',
      'clientSecret',
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
