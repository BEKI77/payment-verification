import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiTags('System')
  @ApiOperation({ summary: 'List available endpoints' })
  root() {
    return {
      name: 'Payment Verification API',
      documentation: 'GET /docs (Swagger UI)',
      endpoints: [
        'GET /verify/:reference (Telebirr)',
        'GET /verify-cbe/:reference (new CBE receipt token)',
        'GET /verify-cbe/:reference/:accountSuffix (legacy FT reference + 8-digit suffix)',
        'GET /verify-cbebirr/:receiptNumber/:phoneNumber',
        'GET /verify-abyssinia/:reference/:suffix (5-digit account suffix)',
        'GET /verify-dashen/:reference',
        'GET /verify-mpesa/:reference',
      ],
    };
  }

  @Get('health')
  @ApiTags('System')
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({ schema: { example: { status: 'ok', timestamp: '2026-07-17T03:00:00.000Z' } } })
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('verify/:reference')
  @ApiTags('Telebirr')
  @ApiOperation({
    summary: 'Verify a Telebirr transaction',
    description:
      'Scrapes the official Ethio Telecom receipt page for the given reference, falling back to any proxies configured in FALLBACK_PROXIES.',
  })
  @ApiParam({ name: 'reference', description: '10-character Telebirr transaction number', example: 'CE12ABC3D4' })
  @ApiOkResponse({
    description: 'Receipt verified',
    schema: {
      example: {
        success: true,
        data: {
          payerName: 'Abebe Kebede',
          payerTelebirrNo: '2519****1314',
          creditedPartyName: 'Kebede Alemu',
          creditedPartyAccountNo: '2519****2425',
          transactionStatus: 'Completed',
          receiptNo: 'CE12ABC3D4',
          paymentDate: '01-07-2026 09:30:00',
          settledAmount: '1500.00 Birr',
          serviceFee: '10.00 Birr',
          serviceFeeVAT: '1.50 Birr',
          totalPaidAmount: '1511.50 Birr',
          bankName: '',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Reference is required' })
  @ApiNotFoundResponse({ description: 'Verification failed or reference not found' })
  async verify(@Param('reference') reference: string) {
    if (!reference) {
      throw new HttpException('Reference is required', HttpStatus.BAD_REQUEST);
    }

    const result = await this.appService.verifyTelebirr(reference);

    if (!result) {
      throw new HttpException('Verification failed or reference not found', HttpStatus.NOT_FOUND);
    }

    return {
      success: true,
      data: result,
    };
  }
}
