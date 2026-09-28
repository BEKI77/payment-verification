// Pure, side-effect-free Telebirr receipt parsing.
//
// This module is imported both by the request path and by the CPU worker pool
// (see cpu-pool.ts / parse.worker.ts). It must stay free of Nest/axios imports
// so it can be loaded cheaply inside a worker thread. `cheerio.load` and the
// regex sweeps below are CPU-bound and are what previously blocked the main
// event loop under load, so all of this now runs off-thread.
import * as cheerio from 'cheerio';

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

export function scrapeTelebirrReceipt(html: string): TelebirrReceipt {
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
