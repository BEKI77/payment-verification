import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Payment Verification API')
    .setDescription(
      'Verifies payment receipts from Ethiopian payment providers: Telebirr, CBE, CBE Birr, Bank of Abyssinia, Dashen and M-Pesa. ' +
        'All endpoints return `{ success: true, data: {...} }` on success and an error message with a 400/404 status on failure.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    autoTagControllers: false,
  });
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
