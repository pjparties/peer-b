import pg from "pg";
const { Pool } = pg;

export class UserService {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        ca: process.env.CERTIFICATE
      }
    });
  }

  async createUsersTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        socket_id VARCHAR(255) PRIMARY KEY,
        status VARCHAR(50) NOT NULL,
        room_name VARCHAR(255),
        last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await this.pool.query(createTableQuery);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active)');
  }

  async addUser(socketId: string): Promise<void> {
    const query = 'INSERT INTO users (socket_id, status) VALUES ($1, $2)';
    await this.pool.query(query, [socketId, 'available']);
  }

  async updateUserStatus(socketId: string, status: string, roomName?: string): Promise<void> {
    const query = 'UPDATE users SET status = $2, room_name = $3, last_active = CURRENT_TIMESTAMP WHERE socket_id = $1';
    await this.pool.query(query, [socketId, status, roomName]);
  }

  async updateUserActivity(socketId: string): Promise<void> {
    const query = 'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE socket_id = $1';
    await this.pool.query(query, [socketId]);
  }

  async findSearchingUser(excludeSocketId: string): Promise<string | null> {
    const query = 'SELECT socket_id FROM users WHERE status = $1 AND socket_id != $2 LIMIT 1';
    const result = await this.pool.query(query, ['searching', excludeSocketId]);
    return result.rows[0]?.socket_id || null;
  }

  async getActiveUserCount(): Promise<number> {
    const query = `
      SELECT COUNT(*) 
      FROM users 
      WHERE last_active > NOW() - INTERVAL '1 HOUR'
    `;
    const result = await this.pool.query(query);
    return parseInt(result.rows[0].count);
  }

  async removeUser(socketId: string): Promise<void> {
    const query = 'DELETE FROM users WHERE socket_id = $1';
    await this.pool.query(query, [socketId]);
  }

  async removeInactiveUsers(inactiveThreshold: number): Promise<string[]> {
    const query = `
      DELETE FROM users 
      WHERE last_active < NOW() - INTERVAL '${inactiveThreshold} HOURS'
      RETURNING socket_id
    `;
    const result = await this.pool.query(query);
    return result.rows.map(row => row.socket_id);
  }
}