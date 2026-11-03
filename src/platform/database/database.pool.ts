import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/** Lazy, read/write PostgreSQL connection owner shared by domain repositories.
 * Database migrations and row-level ACL are not performed by this service.
 */
@Injectable()
export class DatabasePool implements OnModuleDestroy {
  private pool?: Pool;

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new ServiceUnavailableException('Database not configured');
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 3500,
      idleTimeoutMillis: 12000,
      statement_timeout: 4000,
      application_name: 'services-api',
    });
    this.pool.on('error', () => {
      // Deliberately no driver error details: may contain credentials or contacts.
    });
    return this.pool;
  }

  async query<T extends QueryResultRow>(sql: string, values: readonly unknown[]): Promise<QueryResult<T>> {
    try {
      return await this.getPool().query<T>(sql, [...values]);
    } catch {
      throw new ServiceUnavailableException('Database operation unavailable');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
