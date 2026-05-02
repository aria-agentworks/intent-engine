import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

/** Require a valid Clerk session. Attach userId to req for downstream use. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims as Record<string, unknown> | undefined)?.userId as string | undefined
    ?? auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as Request & { userId: string }).userId = userId;
  return next();
}

export type AuthedRequest = Request & { userId: string };
