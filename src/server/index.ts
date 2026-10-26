import { createApp } from './app.js';
import { appConfig } from './config.js';
import { logger } from './logger.js';

const app = createApp();

const server = app.listen(appConfig.port, () => {
  logger.info(
    {
      port: appConfig.port,
      nodeEnv: appConfig.nodeEnv,
      cacheTtlSeconds: appConfig.cacheTtlSeconds,
      corsAllowedOrigins: appConfig.corsAllowedOrigins,
    },
    `RainBomb Backend listening on http://localhost:${appConfig.port}`
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down RainBomb Backend...');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
