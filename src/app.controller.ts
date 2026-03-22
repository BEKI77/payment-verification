import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('verify/:reference')
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
      data: result
    };
  }
}
