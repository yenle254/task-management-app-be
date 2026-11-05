const fs = require('fs');
const path = require('path');

const swaggerJsonPath = path.join(__dirname, '../docs/swagger.json');

// The spec lives under docs/, which is git-ignored, so it is absent on a fresh
// clone. Mounting the docs routes must not take the whole server down: fall
// back to an empty spec and let the UI render instead of throwing at require
// time.
let swaggerSpec = { openapi: '3.0.0', info: { title: 'HR Task Management API', version: '1.0.0' }, paths: {} };
try {
  swaggerSpec = JSON.parse(fs.readFileSync(swaggerJsonPath, 'utf8'));
} catch (error) {
  console.warn(
    `Swagger spec not found at ${swaggerJsonPath}; serving an empty spec instead of the local file.`
  );
}

const setupSwagger = (app) => {
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(swaggerSpec);
  });

  try {
    const swaggerUi = require('swagger-ui-express');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  } catch (_error) {
    app.get('/api-docs', (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>HR Task Management API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({ url: '/api-docs.json', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`);
    });
  }
};

module.exports = {
  swaggerSpec,
  setupSwagger
};
