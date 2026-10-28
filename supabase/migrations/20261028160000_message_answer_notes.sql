-- One line on what each answer covered, written when the answer is saved. The
-- rewriter reads these for turns older than the verbatim window, in place of the
-- rolling summary (which stays for the answer model). Null on messages saved before.
alter table public.messages
  add column answer_note text;
