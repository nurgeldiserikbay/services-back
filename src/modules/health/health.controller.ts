import { Controller, Get, Header } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  service: 'services-back';
}

@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  health(): HealthResponse {
    return { status: 'ok', service: 'services-back' };
  }
}
