const logger = require('../utils/logger');

function globalErrorHandler(err, req, res, next) {
  logger.error(`[ERROR] ${new Date().toISOString()}:`, err.stack || err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Interne server fout';

  // Fallback to JSON error responses for API routes or if requested
  if (req.path.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({
      success: false,
      message: message,
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }

  // Otherwise send error as plain text or simple HTML for regular browser requests
  res.status(status).send(`Error: ${message}`);
}

module.exports = globalErrorHandler;
