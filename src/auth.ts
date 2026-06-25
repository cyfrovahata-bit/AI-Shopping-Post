import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";

const SECRET = process.env.JWT_SECRET || "dev-secret-please-change-in-production";

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function signToken(userId: number) {
  return jwt.sign({ userId }, SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number } {
  return jwt.verify(token, SECRET) as { userId: number };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = verifyToken(auth.slice(7));
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// For OAuth redirect flows: token passed as query param
export function extractTokenFromQuery(req: Request): number | null {
  const token = (req.query.token as string) || "";
  if (!token) return null;
  try {
    return verifyToken(token).userId;
  } catch {
    return null;
  }
}
