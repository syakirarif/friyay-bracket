"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function AdminLoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="text-2xl tracking-tight sm:text-3xl">Command access</h1>
      <p className="mt-2 text-sm text-tatooine-sand/80">
        Enter the host password to continue.
      </p>

      <form action={formAction} className="mt-8 w-full max-w-sm">
        <label
          htmlFor="password"
          className="block text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          className="mt-2 w-full rounded-md border border-saber-blue/40 bg-imperial-gray/40 px-3 py-2 text-base text-zinc-50 outline-none transition focus:border-saber-blue focus:shadow-[0_0_14px_2px_rgba(76,184,255,0.25)]"
          disabled={pending}
        />

        {state.error && (
          <p role="alert" className="mt-3 text-sm text-saber-red">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="saber-glow-blue mt-6 w-full rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Authenticating…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
