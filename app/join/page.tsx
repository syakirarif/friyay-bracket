"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const MAX_LEN = 24;

export default function JoinPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = nickname.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_LEN;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Transmission failed. Try again, pilot.");
        setSubmitting(false);
        return;
      }
      localStorage.setItem(
        "participant",
        JSON.stringify({ id: body.id, nickname: body.nickname }),
      );
      router.push("/joined");
    } catch {
      setError("Network down. Check your comms and retry.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="text-3xl tracking-tight sm:text-4xl">
        Join the FriYAY squad
      </h1>
      <p className="mt-2 text-center text-tatooine-sand/90">
        Pick a call sign. May the FriYAY be with you.
      </p>

      <form onSubmit={onSubmit} className="mt-8 w-full max-w-sm">
        <label
          htmlFor="nickname"
          className="block text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Call sign
        </label>
        <input
          id="nickname"
          name="nickname"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={MAX_LEN}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. Luke, Han, Rey"
          className="mt-2 w-full rounded-md border border-saber-blue/40 bg-imperial-gray/40 px-3 py-2 text-base text-zinc-50 outline-none transition focus:border-saber-blue focus:shadow-[0_0_14px_2px_rgba(76,184,255,0.25)]"
          disabled={submitting}
        />
        <p className="mt-1 text-xs text-zinc-500">
          1–{MAX_LEN} characters.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-3 text-sm text-saber-red"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || submitting}
          className="saber-glow-blue mt-6 w-full rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Joining…" : "Engage"}
        </button>
      </form>
    </main>
  );
}
