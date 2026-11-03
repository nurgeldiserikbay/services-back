import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller.js';
import { GeographyRepository } from './geography.repository.js';

@Module({controllers:[GeographyController],providers:[GeographyRepository]})
export class GeographyModule {}
