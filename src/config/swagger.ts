import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Prawo dla Ciebie API',
            version: '1.0.0',
            description: 'API dla systemu zarządzania dokumentami prawnymi, w tym moduł dla urzędników (v3).',
            contact: {
                name: 'System Support',
            },
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server',
            },
        ],
        components: {
            schemas: {
                LegalDocument: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        title: { type: 'string' },
                        status: { type: 'string', enum: ['DRAFT', 'SEJM', 'SENATE', 'PRESIDENT', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'] },
                        type: { type: 'string', enum: ['USTAWA', 'ROZPORZADZENIE', 'UCHWALA', 'OBWIESZCZENIE', 'ZARZADZENIE', 'DYREKTYWA', 'INNE'] },
                        summary: { type: 'string' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string' }
                    }
                }
            },
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT', // or just opaque string
                },
            },
        },
        security: [
            {
                BearerAuth: [],
            },
        ],
    },
    apis: ['./src/routes/*.ts', './src/index.ts', './src/routes/v3_official.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
