import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

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

  /**
   * Work that changes multiple related records MUST use a single PostgreSQL
   * connection. The callback must not commit/rollback or retain this client.
   * No automatic retries: callers must resolve idempotency after a network
   * error or uncertain COMMIT outcome.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.getPool().connect();
    } catch {
      throw new ServiceUnavailableException('Database operation unavailable');
    }

    let begun = false;
    let released = false;
    try {
      await client.query('BEGIN');
      begun = true;
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '8s'");
      const result = await work(client);
      await client.query('COMMIT');
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Release with an error to discard an uncertain connection.
          client.release(new Error('Transaction rollback failed'));
          released = true;
          throw new ServiceUnavailableException('Database operation unavailable');
        }
      }
      throw error;
    } finally {
      if (!released) client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
