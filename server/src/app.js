import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { setupSwagger } from './config/swagger.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import apiRoutes from './routes.js';

export function createApp() {
  const app = express();

  // Render/Railway đứng sau proxy — cần để req.ip và req.protocol đúng
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.clientUrls }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!env.isTest) app.use(morgan(env.isDev ? 'dev' : 'combined'));

  app.use('/api', apiRoutes);
  setupSwagger(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
