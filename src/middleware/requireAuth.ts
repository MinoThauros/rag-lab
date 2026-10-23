// Auth middleware, mirroring PostgresBackend's requireAuth: the session lives in
// httpOnly cookies; check the access token, refresh once if it expired, then
// put the user on req.user. Cookies also work with EventSource (streaming),
// which can't send an Authorization header.
import type { CookieOptions, NextFunction, Request, Response } from "express";
import type { Session } from "@supabase/supabase-js";
import { authClient } from "../lib/supabase.ts";
import "../types/express.d.ts";

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const cookieOptions: CookieOptions = {
  httpOnly: true, // not readable from page JavaScript
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

export function setAuthCookies(res: Response, session: Session) {
  res.cookie("sb-access-token", session.access_token, cookieOptions);
  res.cookie("sb-refresh-token", session.refresh_token, cookieOptions);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie("sb-access-token", { path: "/" });
  res.clearCookie("sb-refresh-token", { path: "/" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const accessToken = req.cookies["sb-access-token"];
  const refreshToken = req.cookies["sb-refresh-token"];
  if (!accessToken || !refreshToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // 1) Try the access token.
  let {
    data: { user },
    error,
  } = await authClient.auth.getUser(accessToken);

  // 2) If invalid or expired, refresh once.
  if (error || !user) {
    const { data, error: refreshError } = await authClient.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (refreshError || !data.session?.user) {
      clearAuthCookies(res);
      res.status(401).json({ error: "Session expired" });
      return;
    }
    user = data.session.user;
    setAuthCookies(res, data.session);
  }

  // 3) The tenant identity every query is scoped by.
  req.user = { id: user.id, email: user.email };
  next();
}
