import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VerifiersModule } from './verifiers/verifiers.module';

@Module({
  imports: [VerifiersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
