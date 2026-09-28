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

  // Harden keep-alive for running behind a reverse proxy (Traefik on
  // *.app.aletcloud.com). Node's default keepAliveTimeout is only 5s, so it can
  // close an idle socket just as the proxy reuses it, and the proxy then returns
  // a sporadic 502. Keep these ABOVE the proxy's backend idle timeout (Traefik
  // forwardingTimeouts.idleConnTimeout defaults to 90s) so the proxy always
  // refreshes the connection first. headersTimeout must exceed keepAliveTimeout.
  const server = app.getHttpServer();
  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 100_000;
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS) || 105_000;
}
bootstrap();
