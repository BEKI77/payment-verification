import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import * as https from 'https';
import pdf = require('pdf-parse');
import { titleCase } from './verify-result.interface';

export interface DashenVerifyResult {
    success: boolean;
    senderName?: string;
    senderAccountNumber?: string;
    transactionChannel?: string;
    serviceType?: string;
    narrative?: string;
    receiverName?: string;
    phoneNo?: string;
    institutionName?: string;
    transactionReference?: string;
    transferReference?: string;
    transactionDate?: Date;
    transactionAmount?: number;
    serviceCharge?: number;
    exciseTax?: number;
    vat?: number;
    penaltyFee?: number;
    incomeTaxFee?: number;
    interestFee?: number;
    stampDuty?: number;
    discountAmount?: number;
    total?: number;
    error?: string;
}

@Injectable()
export class DashenService {
    private readonly logger = new Logger(DashenService.name);

    async verify(transactionReference: string): Promise<DashenVerifyResult> {
        const url = `https://receipt.dashensuperapp.com/receipt/${transactionReference}`;
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const maxRetries = 5;
        const retryDelay = 2000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`Fetching Dashen receipt (attempt ${attempt}/${maxRetries}): ${url}`);
                const response: AxiosResponse<ArrayBuffer> = await axios.get(url, {
                    httpsAgent,
                    responseType: 'arraybuffer',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Accept': 'application/pdf'
                    },
                    timeout: 60000
                });

                return await this.parseReceipt(response.data);
            } catch (error: any) {
                this.logger.warn(`Dashen receipt fetch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

                if (attempt === maxRetries) {
                    return {
                        success: false,
                        error: `Failed to fetch receipt after ${maxRetries} attempts: ${error.message}`
                    };
                }

                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        return { success: false, error: 'Unknown error in retry loop' };
    }

    private async parseReceipt(buffer: ArrayBuffer): Promise<DashenVerifyResult> {
        try {
            const parsed = await pdf(Buffer.from(buffer));
            const rawText = parsed.text.replace(/\s+/g, ' ').trim();

            const senderName = rawText.match(/Sender\s*Name\s*:?\s*(.*?)\s+(?:Sender\s*Account|Account)/i)?.[1]?.trim();
            const senderAccountNumber = rawText.match(/Sender\s*Account\s*(?:Number)?\s*:?\s*([A-Z0-9\*\-]+)/i)?.[1]?.trim();

            const transactionChannel = rawText.match(/Transaction\s*Channel\s*:?\s*(.*?)\s+(?:Service|Type)/i)?.[1]?.trim();
            const serviceType = rawText.match(/Service\s*Type\s*:?\s*(.*?)\s+(?:Narrative|Description)/i)?.[1]?.trim();
            const narrative = rawText.match(/Narrative\s*:?\s*(.*?)\s+(?:Receiver|Phone)/i)?.[1]?.trim();

            const receiverName = rawText.match(/Receiver\s*Name\s*:?\s*(.*?)\s+(?:Phone|Institution)/i)?.[1]?.trim();
            const phoneNo = rawText.match(/Phone\s*(?:No\.?|Number)?\s*:?\s*([\+\d\-\s]+)/i)?.[1]?.trim();
            const institutionName = rawText.match(/Institution\s*Name\s*:?\s*(.*?)\s+(?:Transaction|Reference)/i)?.[1]?.trim();

            const transactionReference = rawText.match(/Transaction\s*Reference\s*:?\s*([A-Z0-9\-]+)/i)?.[1]?.trim();
            const transferReference = rawText.match(/Transfer\s*Reference\s*:?\s*([A-Z0-9\-]+)/i)?.[1]?.trim();

            const dateRaw = rawText.match(/Transaction\s*Date\s*(?:&\s*Time)?\s*:?\s*([\d\/\-,: ]+(?:[APM]{2})?)/i)?.[1]?.trim();
            const transactionDate = dateRaw ? new Date(dateRaw) : undefined;

            const transactionAmount = this.extractAmount(rawText, /Transaction\s*Amount\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const serviceCharge = this.extractAmount(rawText, /Service\s*Charge\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const exciseTax = this.extractAmount(rawText, /Excise\s*Tax\s*(?:\(15%\))?\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const vat = this.extractAmount(rawText, /VAT\s*(?:\(15%\))?\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const penaltyFee = this.extractAmount(rawText, /Penalty\s*Fee\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const incomeTaxFee = this.extractAmount(rawText, /Income\s*Tax\s*Fee\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const interestFee = this.extractAmount(rawText, /Interest\s*Fee\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const stampDuty = this.extractAmount(rawText, /Stamp\s*Duty\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const discountAmount = this.extractAmount(rawText, /Discount\s*Amount\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);
            const total = this.extractAmount(rawText, /Total\s*(?:ETB|Birr)?\s*([\d,]+\.?\d*)/i);

            const extractedData = {
                senderName: senderName ? titleCase(senderName) : undefined,
                senderAccountNumber,
                transactionChannel,
                serviceType,
                narrative,
                receiverName: receiverName ? titleCase(receiverName) : undefined,
                phoneNo,
                institutionName: institutionName ? titleCase(institutionName) : undefined,
                transactionReference,
                transferReference,
                transactionDate,
                transactionAmount,
                serviceCharge,
                exciseTax,
                vat,
                penaltyFee,
                incomeTaxFee,
                interestFee,
                stampDuty,
                discountAmount,
                total
            };

            if (transactionReference && transactionAmount) {
                return { success: true, ...extractedData };
            }

            this.logger.warn(`Dashen PDF parsing missing required fields: ${!transactionReference ? 'Transaction Reference ' : ''}${!transactionAmount ? 'Transaction Amount' : ''}`);
            return {
                success: false,
                error: 'Could not extract required fields (Transaction Reference and Amount) from PDF.'
            };
        } catch (parseErr: any) {
            this.logger.error(`Dashen PDF parsing failed: ${parseErr.message}`);
            return { success: false, error: 'Error parsing PDF data' };
        }
    }

    private extractAmount(text: string, regex: RegExp): number | undefined {
        const match = text.match(regex);
        if (match && match[1]) {
            const amount = parseFloat(match[1].replace(/,/g, ''));
            return isNaN(amount) ? undefined : amount;
        }
        return undefined;
    }
}
