// Bounded worker-thread pool for CPU-bound parsing (cheerio + pdf-parse).
//
// Before this, HTML scraping and PDF text extraction ran synchronously on the
// main event loop; under load they starved everything else, including the
// trivial /health endpoint. Running them here keeps the main loop free to
// accept connections and serve fast endpoints while parsing happens on
// dedicated threads.
import { Piscina } from 'piscina';
import * as os from 'os';
import * as path from 'path';
import type { TelebirrReceipt } from './telebirr-parser';
import type { ParseTask } from './parse.worker';

function poolSize(): number {
    const fromEnv = Number(process.env.PARSE_POOL_SIZE);
    if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
    // Leave a core for the main event loop; always keep at least one worker.
    return Math.max(1, (os.cpus()?.length || 2) - 1);
}

// The worker resolves to the compiled .js next to this file at runtime (dist/common).
const workerFile = path.resolve(__dirname, 'parse.worker.js');

const pool = new Piscina({
    filename: workerFile,
    minThreads: 1,
    maxThreads: poolSize(),
    // Parsing is CPU-bound, so one task per worker keeps threads from
    // time-slicing against each other.
    concurrentTasksPerWorker: 1,
    idleTimeout: 30_000,
});

function run<T>(task: ParseTask): Promise<T> {
    return pool.run(task) as Promise<T>;
}

export function scrapeTelebirr(html: string): Promise<TelebirrReceipt> {
    return run<TelebirrReceipt>({ kind: 'telebirr', html });
}

export function pdfToText(bytes: ArrayBuffer | Uint8Array | Buffer): Promise<string> {
    // Normalize to a Uint8Array so it structured-clones cleanly into the worker.
    const view =
        bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes as ArrayBuffer);
    return run<string>({ kind: 'pdf', bytes: view });
}

export function closeCpuPool(): Promise<void> {
    return pool.destroy();
}
