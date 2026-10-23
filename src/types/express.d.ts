// req.user is set by middleware/requireAuth.ts: the tenant every query is scoped by.
export type AuthUser = { id: string; email?: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
