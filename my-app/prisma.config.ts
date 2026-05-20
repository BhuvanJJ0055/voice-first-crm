import { defineConfig, env } from '@prisma/config';

// Explicitly load the .env file into the process before evaluating the config
try {
  process.loadEnvFile();
} catch (e) {
  // Ignored
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
