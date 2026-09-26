import * as http from 'http';
import * as https from 'https';

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    const value = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(value) ? value : fallback;
}

// Per-request timeout for upstream receipt sources.
export const UPSTREAM_TIMEOUT_MS = envNumber('UPSTREAM_TIMEOUT_MS', 60000);

// How long to wait on the primary source before also firing the fallback proxies.
export const FALLBACK_HEDGE_DELAY_MS = envNumber('FALLBACK_HEDGE_DELAY_MS', 3000);

// Shared keep-alive agents so repeat requests reuse TCP/TLS connections instead of
// paying for a fresh handshake every time.
const agentOptions = { keepAlive: true, maxSockets: 50, maxFreeSockets: 10 };
export const httpAgent = new http.Agent(agentOptions);
export const httpsAgent = new https.Agent(agentOptions);
export const insecureHttpsAgent = new https.Agent({ ...agentOptions, rejectUnauthorized: false });

type SourceTask<T> = (signal: AbortSignal) => Promise<T | null>;

/**
 * Resolves with the first valid result. The primary runs first; fallbacks start as soon
 * as the primary fails or after `hedgeDelayMs`, whichever comes first. Once a winner is
 * found, the remaining requests are aborted. Resolves null if every source fails.
 */
export function firstValidResult<T>(
    primary: SourceTask<T> | null,
    fallbacks: SourceTask<T>[],
    isValid: (result: T) => boolean,
    hedgeDelayMs = FALLBACK_HEDGE_DELAY_MS,
): Promise<T | null> {
    const controller = new AbortController();

    return new Promise(resolve => {
        let pending = 0;
        let done = false;
        let fallbacksStarted = false;
        let timer: NodeJS.Timeout | undefined;

        const finish = (result: T | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            controller.abort();
            resolve(result);
        };

        const launch = (task: SourceTask<T>, onFail?: () => void) => {
            pending++;
            task(controller.signal)
                .then(result => (result && isValid(result) ? result : null), () => null)
                .then(result => {
                    if (result) return finish(result);
                    onFail?.();
                    if (--pending === 0 && fallbacksStarted) finish(null);
                });
        };

        const startFallbacks = () => {
            if (fallbacksStarted || done) return;
            fallbacksStarted = true;
            clearTimeout(timer);
            fallbacks.forEach(task => launch(task));
            if (pending === 0) finish(null);
        };

        if (primary) {
            launch(primary, startFallbacks);
            timer = setTimeout(startFallbacks, hedgeDelayMs);
        } else {
            startFallbacks();
        }
    });
}
