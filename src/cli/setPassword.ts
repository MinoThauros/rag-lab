// Sets a user's password with the admin key, e.g. for invited users who never
// chose one. The password is typed here, hidden, and never printed or stored.
// Usage: npm run set-password -- you@example.com
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { supabase } from "../lib/supabase.ts";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run set-password -- you@example.com");
  process.exit(1);
}

// Prompt without echoing what's typed.
function askHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  let muted = false;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (!muted) output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No user with email ${email}.`);
  process.exit(1);
}

const password = await askHidden("New password: ");
const confirm = await askHidden("Confirm password: ");
if (password !== confirm) {
  console.error("Passwords don't match.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use at least 8 characters.");
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
if (updateError) {
  console.error(`Could not set the password: ${updateError.message}`);
  process.exit(1);
}
console.log(`Password set for ${email}. Sign in at http://127.0.0.1:5173`);
