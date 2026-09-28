// CPU worker: runs the event-loop-blocking parsing off the main thread.
// Loaded by piscina (see cpu-pool.ts). A single default export dispatches on
// task kind, which is the most robust shape across piscina versions.
import pdf = require('pdf-parse');
import { scrapeTelebirrReceipt, TelebirrReceipt } from './telebirr-parser';

export type ParseTask =
    | { kind: 'telebirr'; html: string }
    | { kind: 'pdf'; bytes: Uint8Array };

export default async function run(task: ParseTask): Promise<TelebirrReceipt | string> {
    switch (task.kind) {
        case 'telebirr':
            return scrapeTelebirrReceipt(task.html);
        case 'pdf': {
            const parsed = await pdf(Buffer.from(task.bytes));
            return parsed.text;
        }
        default:
            throw new Error(`Unknown parse task: ${JSON.stringify(task)}`);
    }
}
