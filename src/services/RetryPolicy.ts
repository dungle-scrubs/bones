/**
 * Exponential backoff retry policy for transient API errors.
 * Designed for LLM API calls that may hit rate limits (429) or server errors (500, 503).
 */

/** Errors considered transient and worth retrying. */
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503]);

/** Default configuration for retry behavior. */
const DEFAULTS = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30_000,
	jitterFraction: 0.2,
} as const;

/** Configuration options for the retry policy. */
export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3). */
	readonly maxRetries?: number;
	/** Base delay in milliseconds before first retry (default: 1000). */
	readonly baseDelayMs?: number;
	/** Maximum delay cap in milliseconds (default: 30000). */
	readonly maxDelayMs?: number;
	/** Fraction of delay to add as jitter, 0-1 (default: 0.2). */
	readonly jitterFraction?: number;
	/** AbortSignal to cancel pending retries. */
	readonly signal?: AbortSignal;
	/** Called before each retry attempt for logging/metrics. */
	readonly onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Determines if an error is transient and worth retrying.
 * Checks for HTTP status codes in the error message/properties and common network errors.
 *
 * @param error - The error to classify
 * @returns True if the error is transient
 */
export function isTransientError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	// Check for status code property (common in HTTP client errors)
	const statusCode =
		(error as unknown as Record<string, unknown>).status ??
		(error as unknown as Record<string, unknown>).statusCode;
	if (
		typeof statusCode === "number" &&
		TRANSIENT_STATUS_CODES.has(statusCode)
	) {
		return true;
	}

	// Check for status code patterns in the message
	const message = error.message.toLowerCase();
	for (const code of TRANSIENT_STATUS_CODES) {
		if (message.includes(String(code))) return true;
	}

	// Common network error patterns
	if (
		message.includes("rate limit") ||
		message.includes("overloaded") ||
		message.includes("timeout") ||
		message.includes("econnreset") ||
		message.includes("econnrefused") ||
		message.includes("socket hang up")
	) {
		return true;
	}

	return false;
}

/**
 * Calculates delay with exponential backoff and jitter.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @param jitterFraction - Fraction of delay to randomize
 * @returns Delay in milliseconds
 */
function calculateDelay(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
	jitterFraction: number,
): number {
	const exponentialDelay = baseDelayMs * 2 ** attempt;
	const capped = Math.min(exponentialDelay, maxDelayMs);
	const jitter = capped * jitterFraction * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(capped + jitter));
}

/**
 * Executes a function with exponential backoff retries on transient errors.
 * Non-transient errors are thrown immediately without retry.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns The function's return value on success
 * @throws The last error after all retries are exhausted, or non-transient errors immediately
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
	const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
	const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
	const jitterFraction = options.jitterFraction ?? DEFAULTS.jitterFraction;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			lastError = err;

			// Don't retry non-transient errors
			if (!isTransientError(err)) {
				throw err;
			}

			// Don't retry if we've exhausted attempts
			if (attempt >= maxRetries) {
				break;
			}

			// Don't retry if aborted
			if (options.signal?.aborted) {
				throw err;
			}

			const delayMs = calculateDelay(
				attempt,
				baseDelayMs,
				maxDelayMs,
				jitterFraction,
			);

			options.onRetry?.(attempt + 1, err, delayMs);

			// Wait with abort support
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(resolve, delayMs);
				if (options.signal) {
					const onAbort = (): void => {
						clearTimeout(timer);
						reject(new Error("Retry aborted"));
					};
					options.signal.addEventListener("abort", onAbort, { once: true });
				}
			});
		}
	}

	throw lastError ?? new Error("Retry failed with no error captured");
}
