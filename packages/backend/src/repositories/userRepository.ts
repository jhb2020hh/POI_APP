import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { db } from "../db/connection.js";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  created_at: string;
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role?: string;
}): Promise<User> {
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 10);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.email, passwordHash, input.displayName, input.role ?? "user");
  return getUserById(id)!;
}

export function getUserById(id: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | User
    | undefined;
}

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export function listUsers(): UserSummary[] {
  return db
    .prepare("SELECT id, email, display_name, role FROM users ORDER BY display_name")
    .all() as unknown as UserSummary[];
}

export async function verifyPassword(
  user: User,
  password: string
): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash);
}
