import { Module } from '@nestjs/common';
import { VerifiersController } from './verifiers.controller';
import { CbeService } from './cbe.service';
import { CbeBirrService } from './cbebirr.service';
import { AbyssiniaService } from './abyssinia.service';
import { DashenService } from './dashen.service';
import { MpesaService } from './mpesa.service';

@Module({
  controllers: [VerifiersController],
  providers: [CbeService, CbeBirrService, AbyssiniaService, DashenService, MpesaService],
})
export class VerifiersModule {}
