import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';

export interface TelebirrReceipt {
    payerName: string;
    payerTelebirrNo: string;
    creditedPartyName: string;
    creditedPartyAccountNo: string;
    transactionStatus: string;
    receiptNo: string;
    paymentDate: string;
    settledAmount: string;
    serviceFee: string;
    serviceFeeVAT: string;
    totalPaidAmount: string;
    bankName: string;
}

const logger = new Logger('TelebirrVerifier');

function extractSettledAmountRegex(htmlContent: string): string | null {
    const pattern1 = /የተከፈለው\s+መጠን\/Settled\s+Amount.*?<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is;
    let match = htmlContent.match(pattern1);
    if (match) return match[1].trim();

    const pattern2 = /<tr[^>]*>.*?የተከፈለው\s+መጠን\/Settled\s+Amount.*?<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is;
    match = htmlContent.match(pattern2);
    if (match) return match[1].trim();

    const pattern3 = /Settled\s+Amount.*?(\d+(?:\.\d{2})?\s+Birr)/is;
    match = htmlContent.match(pattern3);
    if (match) return match[1].trim();

    const pattern4 = /የክፍያ\s+ዝርዝር\/Transaction\s+details.*?<tr[^>]*>.*?<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/is;
    match = htmlContent.match(pattern4);
    if (match) return match[1].trim();

    return null;
}

function extractServiceFeeRegex(htmlContent: string): string | null {
    const pattern = /የአገልግሎት\s+ክፍያ\/Service\s+fee(?!\s+ተ\.እ\.ታ).*?<\/td>\s*<td[^>]*>\s*(\d+(?:\.\d{2})?\s+Birr)/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

function extractReceiptNoRegex(htmlContent: string): string | null {
    const pattern = /<td[^>]*class="[^"]*receipttableTd[^"]*receipttableTd2[^"]*"[^>]*>\s*([A-Z0-9]+)\s*<\/td>/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

function extractDateRegex(htmlContent: string): string | null {
    const pattern = /(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

function extractWithRegex(htmlContent: string, labelPattern: string, valuePattern: string = '([^<]+)'): string | null {
    const escapedLabel = labelPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedLabel}.*?<\\/td>\\s*<td[^>]*>\\s*${valuePattern}`, 'i');
    const match = htmlContent.match(pattern);
    if (match) return match[1].replace(/<[^>]*>/g, '').trim(); 

    return null;
}

function scrapeTelebirrReceipt(html: string): TelebirrReceipt {
    const $ = cheerio.load(html);

    const getText = (selector: string): string =>
        $(selector).next().text().trim();

    const getPaymentDate = (): string => {
        const regexDate = extractDateRegex(html);
        if (regexDate) return regexDate;
        return $('.receipttableTd').filter((_, el) => $(el).text().includes("-202")).first().text().trim();
    };

    const getReceiptNo = (): string => {
        const regexReceiptNo = extractReceiptNoRegex(html);
        if (regexReceiptNo) return regexReceiptNo;
        return $('td.receipttableTd.receipttableTd2')
            .eq(1) 
            .text()
            .trim();
    };

    const getSettledAmount = (): string => {
        const regexAmount = extractSettledAmountRegex(html);
        if (regexAmount) return regexAmount;

        let amount = $('td.receipttableTd.receipttableTd2')
            .filter((_, el) => {
                const prevTd = $(el).prev();
                return prevTd.text().includes("የተከፈለው መጠን") || prevTd.text().includes("Settled Amount");
            })
            .text()
            .trim();

        if (!amount) {
            amount = $('tr')
                .filter((_, el) => {
                    return $(el).find('td').first().text().includes("የተከፈለው መጠን") ||
                        $(el).find('td').first().text().includes("Settled Amount");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        return amount;
    };

    const getServiceFee = (): string => {
        const regexFee = extractServiceFeeRegex(html);
        if (regexFee) return regexFee;

        let fee = $('td.receipttableTd1')
            .filter((_, el) => {
                const text = $(el).text();
                return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                    !text.includes("ተ.እ.ታ") && !text.includes("VAT");
            })
            .next('td.receipttableTd.receipttableTd2')
            .text()
            .trim();

        if (!fee) {
            fee = $('tr')
                .filter((_, el) => {
                    const text = $(el).text();
                    return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                        !text.includes("ተ.እ.ታ") && !text.includes("VAT");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        return fee;
    };

    const getTextWithFallback = (labelText: string, cheerioSelector?: string): string => {
        const regexResult = extractWithRegex(html, labelText);
        if (regexResult) return regexResult;

        if (cheerioSelector) {
            return getText(cheerioSelector);
        }
        return getText(`td:contains("${labelText}")`);
    };

    let creditedPartyName = getTextWithFallback("የገንዘብ ተቀባይ ስም/Credited Party name");
    let creditedPartyAccountNo = getTextWithFallback("የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no");
    let bankName = "";

    const bankAccountNumberRaw = getTextWithFallback("የባንክ አካውንት ቁጥር/Bank account number");

    if (bankAccountNumberRaw) {
        bankName = creditedPartyName; 
        const bankAccountRegex = /(\d+)\s+(.*)/;
        const match = bankAccountNumberRaw.match(bankAccountRegex);
        if (match) {
            creditedPartyAccountNo = match[1].trim();
            creditedPartyName = match[2].trim();
        }
    }

    return {
        payerName: getTextWithFallback("የከፋይ ስም/Payer Name"),
        payerTelebirrNo: getTextWithFallback("የከፋይ ቴሌብር ቁ./Payer telebirr no."),
        creditedPartyName,
        creditedPartyAccountNo,
        transactionStatus: getTextWithFallback("የክፍያው ሁኔታ/transaction status"),
        receiptNo: getReceiptNo(),
        paymentDate: getPaymentDate(),
        settledAmount: getSettledAmount(),
        serviceFee: getServiceFee(),
        serviceFeeVAT: getTextWithFallback("የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT"),
        totalPaidAmount: getTextWithFallback("ጠቅላላ የተከፈለ/Total Paid Amount"),
        bankName
    };
}

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

async function fetchFromPrimarySource(reference: string, baseUrl: string): Promise<TelebirrReceipt | null> {
    const url = `${baseUrl}${reference}`;
    try {
        logger.log(`Fetching from primary source: ${url}`);
        const response = await axios.get(url, { 
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const extractedData = scrapeTelebirrReceipt(response.data);
        return extractedData;
    } catch (error) {
        logger.error(`Error fetching from primary source: ${error.message}`);
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

async function fetchFromProxySource(reference: string, proxyUrl: string): Promise<TelebirrReceipt | null> {
    const isSyntaxApi = proxyUrl.includes('syntaxsoftwaresolution.com.et');
    const url = isSyntaxApi ? proxyUrl : (proxyUrl.includes('?') ? `${proxyUrl}&reference=${reference}` : `${proxyUrl}${reference}`);
    
    try {
        logger.log(`Fetching from proxy: ${url}`);
        
        let response;
        const config = {
            timeout: 15000,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
                return scrapeTelebirrReceipt(response.data);
            }
        }

        if (data && data.success === false && data.error) {
            throw new TelebirrVerificationError(data.error, data.details);
        }

        const extractedData = parseTelebirrJson(data);
        if (!extractedData) return scrapeTelebirrReceipt(response.data);

        return extractedData;
    } catch (error) {
        if (error instanceof TelebirrVerificationError) throw error;
        logger.error(`Error from proxy ${url}: ${error.message}`);
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

        if (!skipPrimary) {
            const primaryResult = await fetchFromPrimarySource(reference, primaryUrl);
            if (primaryResult && isValidReceipt(primaryResult)) return primaryResult;
        }

        for (const proxyUrl of fallbackProxies) {
            try {
                const fallbackResult = await fetchFromProxySource(reference, proxyUrl);
                if (fallbackResult && isValidReceipt(fallbackResult)) return fallbackResult;
            } catch (error) {
                logger.warn(`Proxy ${proxyUrl} failed: ${error.message}`);
            }
        }

        return null;
    }
}
