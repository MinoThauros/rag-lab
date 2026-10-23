// HTTP API for the web app (web/). Every route except login requires a Supabase
// session (httpOnly cookies) and is scoped to req.user.id.
// Usage: npm run web:api   (listens on 127.0.0.1:3100, local only)
import cookieParser from "cookie-parser";
import express from "express";
import { askRouter } from "./routes/askRouter.ts";
import { authRouter } from "./routes/authRouter.ts";
import { conversationsRouter } from "./routes/conversationsRouter.ts";

const PORT = 3100;

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/ask", askRouter);

app.listen(PORT, "127.0.0.1", (error) => {
  if (error) {
    // Express 5 reports listen errors here (e.g. EADDRINUSE); don't claim to be running.
    console.error(`Could not start the API on port ${PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`API on http://127.0.0.1:${PORT}`);
});
