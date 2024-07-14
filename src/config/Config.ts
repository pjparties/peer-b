import dotenv from "dotenv";

dotenv.config({ path: ".env" });

export class Config {
  static PORT: number = parseInt(process.env.PORT || "8000", 10);
  static FRONTEND_URL: string = process.env.FRONTEND_URL || 'http://localhost:3000';
  static DB_CONFIG = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || "5432", 10),
  };
}