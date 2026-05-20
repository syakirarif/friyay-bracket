"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_TTL_SECONDS,
  signAdminCookie,
} from "@/lib/adminAuth";

export interface LoginState {
  error: string | null;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = formData.get("password");
  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_COOKIE_SECRET;

  if (!expected || !secret) {
    return { error: "Server is not configured (missing admin env)." };
  }
  if (typeof password !== "string" || password.length === 0) {
    return { error: "Password is required." };
  }
  if (password !== expected) {
    return { error: "Incorrect password." };
  }

  const { value } = await signAdminCookie(secret);
  const jar = await cookies();
  jar.set({
    name: ADMIN_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COOKIE_TTL_SECONDS,
  });

  redirect("/admin");
}
