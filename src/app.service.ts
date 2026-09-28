import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { UPSTREAM_TIMEOUT_MS, firstValidResult, httpAgent, httpsAgent, insecureHttpsAgent } from './common/http';
import { TelebirrReceipt } from './common/telebirr-parser';
import * as cpuPool from './common/cpu-pool';

export { TelebirrReceipt };

const logger = new Logger('TelebirrVerifier');

function parseTelebirrJson(jsonData: any): TelebirrReceipt | null {
    try {
        if (!jsonData) return null;

        if (jsonData.amount && jsonData.message !== undefined) {
            return {
                payerName: "",
                payerTelebirrNo: "",
                creditedPartyName: "",
                creditedPartyAccountNo: "",
                transactionStatus: "Completed",
                receiptNo: "",
                paymentDate: "",
                settledAmount: jsonData.amount,
                serviceFee: "",
                serviceFeeVAT: "",
                totalPaidAmount: jsonData.amount,
                bankName: ""
            };
        }

        if (!jsonData.success || !jsonData.data) return null;
        const data = jsonData.data;

        return {
            payerName: data.payerName || "",
            payerTelebirrNo: data.payerTelebirrNo || "",
            creditedPartyName: data.creditedPartyName || "",
            creditedPartyAccountNo: data.creditedPartyAccountNo || "",
            transactionStatus: data.transactionStatus || "",
            receiptNo: data.receiptNo || "",
            paymentDate: data.paymentDate || "",
            settledAmount: data.settledAmount || "",
            serviceFee: data.serviceFee || "",
            serviceFeeVAT: data.serviceFeeVAT || "",
            totalPaidAmount: data.totalPaidAmount || "",
            bankName: data.bankName || ""
        };
    } catch (error) {
        return null;
    }
}

async function fetchFromPrimarySource(reference: string, baseUrl: string, signal?: AbortSignal): Promise<TelebirrReceipt | null> {
    const url = `${baseUrl}${reference}`;
    try {
        logger.log(`Fetching from primary source: ${url}`);
        const response = await axios.get(url, {
            timeout: UPSTREAM_TIMEOUT_MS,
            httpAgent,
            httpsAgent,
            signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const extractedData = await cpuPool.scrapeTelebirr(response.data);
        return extractedData;
    } catch (error) {
        if (!axios.isCancel(error)) logger.error(`Error fetching from primary source: ${error.message}`);
        return null;
    }
}

export class TelebirrVerificationError extends Error {
    public details?: string;
    constructor(message: string, details?: string) {
        super(message);
        this.name = 'TelebirrVerificationError';
        this.details = details;
    }
}

async function fetchFromProxySource(reference: string, proxyUrl: string, signal?: AbortSignal): Promise<TelebirrReceipt | null> {
    const isSyntaxApi = proxyUrl.includes('syntaxsoftwaresolution.com.et');
    const url = isSyntaxApi ? proxyUrl : (proxyUrl.includes('?') ? `${proxyUrl}&reference=${reference}` : `${proxyUrl}${reference}`);

    try {
        logger.log(`Fetching from proxy: ${url}`);

        let response;
        const config = {
            timeout: UPSTREAM_TIMEOUT_MS,
            httpAgent,
            httpsAgent: insecureHttpsAgent,
            signal,
            headers: {
                'Accept': 'application/json, text/html, */*',
                'User-Agent': 'Dash-Bingo-Bot/1.0',
                'Connection': 'keep-alive'
            }
        };

        if (isSyntaxApi) {
            response = await axios.post(url, { transaction_id: reference }, config);
        } else {
            response = await axios.get(url, config);
        }

        let data = response.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) {
                return await cpuPool.scrapeTelebirr(response.data);
            }
        }

        if (data && data.success === false && data.error) {
            throw new TelebirrVerificationError(data.error, data.details);
        }

        const extractedData = parseTelebirrJson(data);
        if (!extractedData) return await cpuPool.scrapeTelebirr(response.data);

        return extractedData;
    } catch (error) {
        if (error instanceof TelebirrVerificationError) throw error;
        if (!axios.isCancel(error)) logger.error(`Error from proxy ${url}: ${error.message}`);
        return null;
    }
}

function isValidReceipt(receipt: TelebirrReceipt): boolean {
    return Boolean(receipt.receiptNo && receipt.payerName && receipt.transactionStatus);
}

@Injectable()
export class AppService {
    async verifyTelebirr(reference: string): Promise<TelebirrReceipt | null> {
        const primaryUrl = "https://transactioninfo.ethiotelecom.et/receipt/";
        const envProxies = process.env.FALLBACK_PROXIES || "";
        const fallbackProxies = envProxies.split(',').map(url => url.trim()).filter(url => url.length > 0);
        const skipPrimary = process.env.SKIP_PRIMARY_VERIFICATION === "true";

        // Proxies start if the primary fails or is still pending after FALLBACK_HEDGE_DELAY_MS;
        // the first valid receipt wins and the other requests are aborted.
        return firstValidResult(
            skipPrimary ? null : signal => fetchFromPrimarySource(reference, primaryUrl, signal),
            fallbackProxies.map(proxyUrl => signal =>
                fetchFromProxySource(reference, proxyUrl, signal).catch(error => {
                    logger.warn(`Proxy ${proxyUrl} failed: ${error.message}`);
                    return null;
                }),
            ),
            isValidReceipt,
        );
    }
}
