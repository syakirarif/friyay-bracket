"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

interface Props {
  size?: number;
  className?: string;
}

// Builds the /join URL from NEXT_PUBLIC_BASE_URL with a runtime fallback to
// window.location.origin (so a fresh laptop without the env var still works).
export function QRJoinCode({ size = 256, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const envBase = process.env.NEXT_PUBLIC_BASE_URL;
    const base = envBase && envBase.length > 0 ? envBase : window.location.origin;
    setUrl(`${base.replace(/\/$/, "")}/join`);
  }, []);

  if (!url) {
    return (
      <div
        style={{ width: size, height: size }}
        className={className}
        aria-hidden
      />
    );
  }

  return (
    <div className={className}>
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        marginSize={2}
        bgColor="#ffffff"
        fgColor="#000000"
      />
      <p className="mt-2 break-all text-center text-xs text-zinc-500">{url}</p>
    </div>
  );
}
