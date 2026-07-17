import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { VerifyResult } from './verify-result.interface';

@Injectable()
export class AbyssiniaService {
    private readonly logger = new Logger(AbyssiniaService.name);

    /**
     * Verify Abyssinia bank transaction by fetching JSON data from their API
     * @param reference Transaction reference (e.g., "FT23062669JJ")
     * @param suffix Last 5 digits of user's account (e.g., "90172")
     */
    async verify(reference: string, suffix: string): Promise<VerifyResult> {
        try {
            this.logger.log(`Starting Abyssinia verification for reference: ${reference} with suffix: ${suffix}`);

            const apiUrl = `https://cs.bankofabyssinia.com/api/onlineSlip/getDetails/?id=${reference}${suffix}`;

            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            const jsonData = response.data;

            if (!jsonData || !jsonData.header || !jsonData.body || !Array.isArray(jsonData.body)) {
                this.logger.error('Invalid response structure from Abyssinia API');
                return { success: false, error: 'Invalid response structure from Abyssinia API' };
            }

            if (jsonData.header.status !== 'success') {
                this.logger.error(`Abyssinia API returned error status: ${jsonData.header.status}`);
                return { success: false, error: `API returned error status: ${jsonData.header.status}` };
            }

            if (jsonData.body.length === 0) {
                this.logger.error('No transaction data found in Abyssinia response body');
                return { success: false, error: 'No transaction data found in response body' };
            }

            const transactionData = jsonData.body[0];

            const transferredAmountStr = transactionData['Transferred Amount'] || transactionData['Total Amount including VAT'] || '';
            const amount = transferredAmountStr ? parseFloat(transferredAmountStr.replace(/[^\d.]/g, '')) : undefined;

            const transactionDateStr = transactionData['Transaction Date'] || '';
            const date = transactionDateStr ? new Date(transactionDateStr) : undefined;

            const result: VerifyResult = {
                success: true,
                payer: transactionData["Payer's Name"] || transactionData['Source Account Name'] || undefined,
                payerAccount: transactionData['Source Account'] || transactionData["Payer's Account"] || undefined,
                receiver: transactionData["Receiver's Name"] || transactionData['Beneficiary Name'] || undefined,
                receiverAccount: transactionData["Receiver's Account"] || transactionData['Beneficiary Account'] || undefined,
                amount,
                date,
                reference: transactionData['Transaction Reference'] || transactionData['Payment Reference'] || undefined,
                reason: transactionData['Narrative'] || transactionData['Transaction Type'] || null
            };

            if (!result.reference || !result.amount) {
                this.logger.error('Missing essential fields in Abyssinia transaction data');
                return { success: false, error: 'Missing essential fields in transaction data' };
            }

            this.logger.log(`Successfully parsed Abyssinia receipt for reference: ${result.reference}`);
            return result;
        } catch (error) {
            if (error instanceof AxiosError) {
                this.logger.error(`HTTP error fetching Abyssinia receipt: ${error.message} (status: ${error.response?.status})`);
            } else {
                this.logger.error(`Unexpected error in Abyssinia verification: ${error instanceof Error ? error.message : error}`);
            }
            return { success: false, error: 'Failed to verify Abyssinia transaction' };
        }
    }
}
