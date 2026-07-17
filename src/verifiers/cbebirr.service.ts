import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import pdf = require('pdf-parse');

export interface CBEBirrReceipt {
    customerName: string;
    debitAccount: string;
    creditAccount: string;
    receiverName: string;
    orderId: string;
    transactionStatus: string;
    reference: string;
    receiptNumber: string;
    transactionDate: string;
    amount: string;
    paidAmount: string;
    serviceCharge: string;
    vat: string;
    totalPaidAmount: string;
    paymentReason: string;
    paymentChannel: string;
}

export type CBEBirrResult = CBEBirrReceipt | { success: false; error: string };

@Injectable()
export class CbeBirrService {
    private readonly logger = new Logger(CbeBirrService.name);

    async verify(receiptNumber: string, phoneNumber: string, apiKey?: string): Promise<CBEBirrResult> {
        try {
            this.logger.log(`[CBEBirr] Starting verification for receipt: ${receiptNumber}, phone: ${phoneNumber}`);

            const url = `https://cbepay1.cbe.com.et/aureceipt?TID=${receiptNumber}&PH=${phoneNumber}`;

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: {
                    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30000
            });

            if (response.status !== 200) {
                this.logger.error(`[CBEBirr] Failed to fetch PDF: HTTP ${response.status}`);
                return { success: false, error: `Failed to fetch receipt: HTTP ${response.status}` };
            }

            const pdfData = await pdf(Buffer.from(response.data));
            const receiptData = this.parseReceipt(pdfData.text);

            if (!receiptData) {
                this.logger.error('[CBEBirr] Failed to parse receipt data from PDF');
                return { success: false, error: 'Failed to parse receipt data from PDF' };
            }

            return receiptData;
        } catch (error) {
            this.logger.error(`[CBEBirr] Error during verification: ${error instanceof Error ? error.message : error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }

    private parseReceipt(pdfText: string): CBEBirrReceipt | null {
        try {
            const extractValue = (text: string, pattern: RegExp): string => {
                const match = text.match(pattern);
                const result = match && match[1] ? match[1].trim() : '';
                return result.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
            };

            const customerName = extractValue(pdfText, /Sub city:[\s\n]+([A-Z\s]+?)[\s\n]+Wereda\/kebele:/i);

            const debitAccountMatch = pdfText.match(/Debit Account\s*(Org Account|[\s\S]*?)(?=\s*Credit Account)/i);
            const debitAccount = debitAccountMatch ? debitAccountMatch[1].replace(/\n/g, ' ').trim() : '';
            const creditAccount = extractValue(pdfText, /Credit Account\s*([\s\S]*?)(?=\s*Receiver Name)/i);
            const receiverName = extractValue(pdfText, /Receiver Name\s*([\s\S]*?)(?=\s*Order ID)/i);

            const orderId = extractValue(pdfText, /Order ID\s*([A-Z0-9]+)/i);
            const transactionStatus = extractValue(pdfText, /Transaction Status\s*([a-zA-Z]+)/i);

            const refMatch = pdfText.match(/Reference[\s:]*([\s\S]*?)(?=\s*(?:Transaction Details|Receipt Number|የኢትዮጵያ|Commercial Bank))/i);
            let reference = refMatch ? refMatch[1].replace(/\n/g, ' ').trim() : '';
            reference = reference.replace(/^[\s:]+|[\s:]+$/g, '');

            const receiptDataMatch = pdfText.match(/([A-Z0-9]{10})(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})([\d.]+)/);
            const receiptNumber = receiptDataMatch ? receiptDataMatch[1] : '';
            const transactionDate = receiptDataMatch ? receiptDataMatch[2] : '';
            const amount = receiptDataMatch ? receiptDataMatch[3] : '';

            const financialMatch = pdfText.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+Paid amount/i);
            const paidAmount = financialMatch ? financialMatch[1] : '';
            const serviceCharge = financialMatch ? financialMatch[2] : '';
            const vat = financialMatch ? financialMatch[3] : '';
            const totalPaidAmount = financialMatch ? financialMatch[4] : '';

            const paymentMatch = pdfText.match(/Payment Channel[\s\n]+([^\n]+)[\s\n]+([^\n]+)[\s\n]+([^\n]+)/i);
            const paymentReason = paymentMatch ? paymentMatch[2].trim() : '';
            const paymentChannel = paymentMatch ? paymentMatch[3].trim() : '';

            const receiptData: CBEBirrReceipt = {
                customerName,
                debitAccount,
                creditAccount,
                receiverName,
                orderId,
                transactionStatus,
                reference,
                receiptNumber,
                transactionDate,
                amount,
                paidAmount,
                serviceCharge,
                vat,
                totalPaidAmount,
                paymentReason,
                paymentChannel
            };

            if (!customerName && !receiptNumber && !amount) {
                this.logger.warn('[CBEBirr] No essential fields found in PDF');
                return null;
            }

            return receiptData;
        } catch (error) {
            this.logger.error(`[CBEBirr] Error parsing PDF text: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }
}
