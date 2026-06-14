/**
 * PULSE CRM — Rate Limiter Middleware
 * 
 * Implements in-memory rate limiting for API endpoints.
 * Production: Replace with Redis-backed rate limiter for distributed systems.
 * 
 * Pattern: Token Bucket (same as Channel Service)
 * Reference: SRS §12.3 - Rate Limiting Specification
 */

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

class InMemoryRateLimiter {
  private clients = new Map<string, ClientRecord>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  check(identifier: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const client = this.clients.get(identifier);

    if (!client || now > client.resetTime) {
      // New window or expired window
      this.clients.set(identifier, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return { allowed: true };
    }

    if (client.count < this.config.maxRequests) {
      client.count++;
      return { allowed: true };
    }

    // Rate limit exceeded
    const retryAfterMs = client.resetTime - now;
    return { allowed: false, retryAfterMs };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, client] of this.clients.entries()) {
      if (now > client.resetTime) {
        this.clients.delete(key);
      }
    }
  }

  getStatus() {
    return {
      activeClients: this.clients.size,
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests,
    };
  }
}

// Webhook endpoint rate limiter: 1000 requests per minute per IP
export const webhookRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000,
  message: 'Too many webhook events from this IP',
});

// General API rate limiter: 100 requests per minute per IP
export const apiRateLimiter = new InMemoryRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: 'Too many requests from this IP',
});

/**
 * Extract client identifier from request (IP address or forwarded IP)
 */
export function getClientIdentifier(request: Request): string {
  // Check for forwarded IP (from reverse proxy)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  // Check for real IP (Cloudflare, Vercel)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to connection IP (Node.js)
  // Note: In Next.js edge runtime, this might not be available
  return 'unknown';
}

/**
 * Rate limit check helper for API routes
 * Returns NextResponse with 429 if rate limit exceeded, null otherwise
 */
export function checkRateLimit(
  request: Request, 
  limiter: InMemoryRateLimiter
): Response | null {
  const clientId = getClientIdentifier(request);
  const result = limiter.check(clientId);

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil((result.retryAfterMs || 0) / 1000);
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: limiter['config'].message || 'Rate limit exceeded',
          retry_after: retryAfterSeconds,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(limiter['config'].maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + retryAfterSeconds),
        },
      }
    );
  }

  return null;
}
