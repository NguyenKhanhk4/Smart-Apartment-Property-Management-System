import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';

async function start() {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`🚀 API:     http://localhost:${env.port}/api`);
    console.log(`📚 Swagger: http://localhost:${env.port}/api-docs`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} — đang tắt server...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

start().catch((err) => {
  console.error('❌ Không khởi động được server:', err.message);
  process.exit(1);
});
