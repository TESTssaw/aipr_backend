class GeminiAPIError extends Error {
  constructor(message, type, retryable = false, retryAfter = null) {
    super(message);
    this.name = 'GeminiAPIError';
    this.type = type;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

const handleGeminiError = (error) => {
  const errorMessage = error.message || '';
  const statusCode = error.status || error.code;
  
  // Rate limiting errors
  if (statusCode === 429 || errorMessage.includes('RATE_LIMIT_EXCEEDED') || errorMessage.includes('quota')) {
    const retryAfter = error.headers?.['retry-after'] || 60; // Default 60 seconds
    return new GeminiAPIError(
      `Gemini API rate limit exceeded. Please try again in ${retryAfter} seconds.`,
      'RATE_LIMIT',
      true,
      retryAfter
    );
  }
  
  // Quota exceeded
  if (statusCode === 403 || errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('billing')) {
    return new GeminiAPIError(
      'Gemini API quota exceeded. Please check your billing settings.',
      'QUOTA_EXCEEDED',
      false
    );
  }
  
  // Content policy violations
  if (errorMessage.includes('CONTENT_POLICY') || errorMessage.includes('blocked') || errorMessage.includes('safety')) {
    return new GeminiAPIError(
      'Content policy violation. The review request was blocked by safety filters.',
      'CONTENT_POLICY',
      false
    );
  }
  
  // Invalid API key
  if (statusCode === 401 || errorMessage.includes('INVALID_API_KEY') || errorMessage.includes('unauthorized')) {
    return new GeminiAPIError(
      'Invalid Gemini API key. Please check your configuration.',
      'INVALID_API_KEY',
      false
    );
  }
  
  // Model unavailable
  if (errorMessage.includes('MODEL_NOT_FOUND') || errorMessage.includes('unavailable')) {
    return new GeminiAPIError(
      'Gemini model is currently unavailable. Please try again later.',
      'MODEL_UNAVAILABLE',
      true,
      30
    );
  }
  
  // Network errors
  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNRESET') || errorMessage.includes('timeout')) {
    return new GeminiAPIError(
      'Network error connecting to Gemini API. Retrying...',
      'NETWORK_ERROR',
      true,
      5
    );
  }
  
  // Response parsing errors
  if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
    return new GeminiAPIError(
      'Failed to parse Gemini API response. The model may have returned invalid data.',
      'PARSE_ERROR',
      true,
      10
    );
  }
  
  // Generic error
  return new GeminiAPIError(
    'An error occurred while processing your review request.',
    'GENERIC_ERROR',
    true,
    15
  );
};

const getRetryDelay = (attempt, baseDelay = 1000) => {
  // Exponential backoff with jitter
  const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  return Math.min(delay, 30000); // Cap at 30 seconds
};

module.exports = {
  GeminiAPIError,
  handleGeminiError,
  getRetryDelay
};