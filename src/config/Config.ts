import dotenv from "dotenv";

dotenv.config({ path: ".env" });

export class Config {
  static PORT: number = parseInt(process.env.PORT || "8000", 10);
  static FRONTEND_URL: string = process.env.FRONTEND_URL || 'http://localhost:3000';
}