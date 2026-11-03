import { Global, Module } from '@nestjs/common';
import { DatabasePool } from './database.pool.js';

@Global()
@Module({providers:[DatabasePool],exports:[DatabasePool]})
export class DatabaseModule {}
