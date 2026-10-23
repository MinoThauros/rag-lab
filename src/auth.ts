// Login routes. Accounts are created in the Supabase dashboard; there's no sign-up.
import { Router } from "express";
import { clearAuthCookies, requireAuth, setAuthCookies } from "./requireAuth.ts";
import { authClient } from "./supabase.ts";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  setAuthCookies(res, data.session);
  res.json({ id: data.user.id, email: data.user.email });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});
