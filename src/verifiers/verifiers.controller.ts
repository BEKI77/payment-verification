import { Controller, Get, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { CbeService, isLegacyCBEReference, isNewCBEReference } from './cbe.service';
import { CbeBirrService } from './cbebirr.service';
import { AbyssiniaService } from './abyssinia.service';
import { DashenService } from './dashen.service';
import { MpesaService } from './mpesa.service';

const bankResultExample = {
  success: true,
  data: {
    success: true,
    payer: 'Abebe Kebede',
    payerAccount: '1****1234',
    receiver: 'Kebede Alemu',
    receiverAccount: '1****5678',
    amount: 1500.0,
    date: '2026-07-01T09:30:00.000Z',
    reference: 'FT26123ABC45',
    reason: 'Transfer to family',
  },
};

@Controller()
export class VerifiersController {
  constructor(
    private readonly cbeService: CbeService,
    private readonly cbeBirrService: CbeBirrService,
    private readonly abyssiniaService: AbyssiniaService,
    private readonly dashenService: DashenService,
    private readonly mpesaService: MpesaService,
  ) {}

  @Get(['verify-cbe/:reference', 'verify-cbe/:reference/:accountSuffix'])
  @ApiTags('CBE')
  @ApiOperation({
    summary: 'Verify a Commercial Bank of Ethiopia transaction',
    description:
      'Supports two reference formats: a new-style receipt token (15-25 alphanumeric characters, no suffix needed) ' +
      'or a legacy `FT...` reference (12 characters), which requires the payer account suffix as a second path segment.',
  })
  @ApiParam({ name: 'reference', description: 'New CBE receipt token or legacy FT reference', example: 'FT26123ABC45' })
  @ApiParam({ name: 'accountSuffix', required: false, description: 'Last 8 digits of the payer account (legacy FT references only)', example: '12345678' })
  @ApiOkResponse({ description: 'Transaction verified', schema: { example: bankResultExample } })
  @ApiBadRequestResponse({ description: 'Invalid reference format, or missing accountSuffix for a legacy reference' })
  @ApiNotFoundResponse({ description: 'Verification failed or reference not found' })
  async verifyCbe(
    @Param('reference') reference: string,
    @Param('accountSuffix') accountSuffix?: string,
  ) {
    const normalizedReference = reference.trim();
    const trimmedSuffix = accountSuffix?.trim();

    if (!isLegacyCBEReference(normalizedReference) && !isNewCBEReference(normalizedReference)) {
      throw new HttpException('Invalid CBE reference format.', HttpStatus.BAD_REQUEST);
    }

    if (isLegacyCBEReference(normalizedReference) && !trimmedSuffix) {
      throw new HttpException('Legacy CBE verification requires accountSuffix (verify-cbe/:reference/:accountSuffix).', HttpStatus.BAD_REQUEST);
    }

    const result = await this.cbeService.verify(normalizedReference, trimmedSuffix);

    if (!result.success) {
      throw new HttpException(result.error || 'Verification failed or reference not found', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: result };
  }

  @Get('verify-cbebirr/:receiptNumber/:phoneNumber')
  @ApiTags('CBE Birr')
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Verify a CBE Birr transaction',
    description:
      'Fetches and parses the CBE Birr PDF receipt. An optional API key can be supplied via the `Authorization: Bearer ...` ' +
      'or `x-api-key` header; it is forwarded upstream when fetching the receipt.',
  })
  @ApiParam({ name: 'receiptNumber', description: '10-character CBE Birr receipt number', example: 'C1A2B3C4D5' })
  @ApiParam({ name: 'phoneNumber', description: 'Ethiopian phone number: 251 followed by 9 digits', example: '251911121314' })
  @ApiOkResponse({
    description: 'Receipt verified',
    schema: {
      example: {
        success: true,
        data: {
          customerName: 'ABEBE KEBEDE',
          debitAccount: '1****1234',
          creditAccount: '1****5678',
          receiverName: 'Kebede Alemu',
          orderId: 'ORD123456',
          transactionStatus: 'Completed',
          reference: 'C1A2B3C4D5',
          receiptNumber: 'C1A2B3C4D5',
          transactionDate: '2026-07-01 09:30',
          amount: '1500.00',
          paidAmount: '1500.00',
          serviceCharge: '10.00',
          vat: '1.50',
          totalPaidAmount: '1511.50',
          paymentReason: 'Transfer',
          paymentChannel: 'USSD',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid Ethiopian phone number format' })
  @ApiNotFoundResponse({ description: 'Verification failed or receipt not found' })
  async verifyCbeBirr(
    @Param('receiptNumber') receiptNumber: string,
    @Param('phoneNumber') phoneNumber: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-api-key') xApiKey?: string,
  ) {
    if (!/^251\d{9}$/.test(phoneNumber)) {
      throw new HttpException(
        'Invalid Ethiopian phone number format. Must start with 251 and be 12 digits total',
        HttpStatus.BAD_REQUEST,
      );
    }

    const apiKey = authorization?.replace('Bearer ', '') || xApiKey;
    const result = await this.cbeBirrService.verify(receiptNumber, phoneNumber, apiKey);

    if ('success' in result && result.success === false) {
      throw new HttpException(result.error || 'Verification failed or reference not found', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: result };
  }

  @Get('verify-abyssinia/:reference/:suffix')
  @ApiTags('Abyssinia')
  @ApiOperation({
    summary: 'Verify a Bank of Abyssinia transaction',
    description: 'Fetches transaction details from the Bank of Abyssinia online slip API.',
  })
  @ApiParam({ name: 'reference', description: 'Transaction reference', example: 'FT23062669JJ' })
  @ApiParam({ name: 'suffix', description: 'Last 5 digits of the account', example: '90172' })
  @ApiOkResponse({ description: 'Transaction verified', schema: { example: bankResultExample } })
  @ApiBadRequestResponse({ description: 'Suffix is not exactly 5 digits' })
  @ApiNotFoundResponse({ description: 'Transaction not found or verification failed' })
  async verifyAbyssinia(
    @Param('reference') reference: string,
    @Param('suffix') suffix: string,
  ) {
    if (!/^\d{5}$/.test(suffix)) {
      throw new HttpException('Invalid suffix: must be exactly 5 digits', HttpStatus.BAD_REQUEST);
    }

    const result = await this.abyssiniaService.verify(reference.trim(), suffix);

    if (!result.success) {
      throw new HttpException(result.error || 'Transaction not found or verification failed', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: result };
  }

  @Get('verify-dashen/:reference')
  @ApiTags('Dashen')
  @ApiOperation({
    summary: 'Verify a Dashen Bank transaction',
    description: 'Fetches and parses the Dashen super app PDF receipt (retries up to 5 times).',
  })
  @ApiParam({ name: 'reference', description: '16-character transaction reference', example: '1234567890123456' })
  @ApiOkResponse({
    description: 'Transaction verified',
    schema: {
      example: {
        success: true,
        data: {
          success: true,
          senderName: 'Abebe Kebede',
          senderAccountNumber: '1234****5678',
          transactionChannel: 'Mobile',
          serviceType: 'Transfer',
          narrative: 'Payment',
          receiverName: 'Kebede Alemu',
          phoneNo: '+251911121314',
          institutionName: 'Dashen Bank',
          transactionReference: '1234567890123456',
          transferReference: 'TRF-987654',
          transactionDate: '2026-07-01T09:30:00.000Z',
          transactionAmount: 1500.0,
          serviceCharge: 10.0,
          vat: 1.5,
          total: 1511.5,
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Verification failed or reference not found' })
  async verifyDashen(@Param('reference') reference: string) {
    const result = await this.dashenService.verify(reference.trim());

    if (!result.success) {
      throw new HttpException(result.error || 'Verification failed or reference not found', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: result };
  }

  @Get('verify-mpesa/:reference')
  @ApiTags('M-Pesa')
  @ApiOperation({
    summary: 'Verify an M-Pesa (Safaricom Ethiopia) transaction',
    description: 'Fetches the receipt from the M-Pesa business API (with proxy fallback) and parses the returned PDF.',
  })
  @ApiParam({ name: 'reference', description: 'M-Pesa transaction ID', example: 'SFC1A2B3C4' })
  @ApiOkResponse({
    description: 'Transaction verified',
    schema: {
      example: {
        success: true,
        data: {
          success: true,
          payerName: 'Abebe Kebede',
          payerAccount: '251911121314',
          receiverName: 'Kebede Alemu',
          receiverAccount: '251922232425',
          transactionId: 'SFC1A2B3C4',
          receiptNo: 'SFC1A2B3C4',
          paymentDate: '2026-07-01T09:30:00.000Z',
          amount: 1500.0,
          serviceFee: 10.0,
          vat: 1.5,
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Verification failed or reference not found' })
  async verifyMpesa(@Param('reference') reference: string) {
    const result = await this.mpesaService.verify(reference.trim());

    if (!result.success) {
      throw new HttpException(result.error || 'Verification failed or reference not found', HttpStatus.NOT_FOUND);
    }

    return { success: true, data: result };
  }
}
