import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'SAPMS API',
    version: '0.1.0',
    description: 'Smart Apartment Property Management System — tài liệu API',
  },
  servers: [{ url: '/api' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    parameters: {
      page: { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
      limit: {
        in: 'query',
        name: 'limit',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    schemas: {
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 134 },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Dữ liệu đầu vào không hợp lệ' },
          errorCode: { type: 'string', example: 'VALIDATION_ERROR' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: { field: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

// Viết doc bằng comment `@openapi` ngay trên route trong src/routes.js hoặc src/modules/**/*.routes.js
export function setupSwagger(app) {
  const spec = swaggerJsdoc({
    definition,
    apis: [`${srcDir}/routes.js`, `${srcDir}/modules/**/*.routes.js`],
  });
  app.get('/api-docs.json', (_req, res) => res.json(spec));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'SAPMS API' }));
}
