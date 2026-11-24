import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: process.env.WEB_OPENAPI_INPUT,
  output: process.env.WEB_CLIENT_OUTPUT,
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@hey-api/client-fetch',
    '@tanstack/react-query',
  ],
});
