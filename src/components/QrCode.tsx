"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a QR code as an inline SVG (works offline, prints crisply). */
export default function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", width: size })
      .then(setSvg).catch(() => setSvg(""));
  }, [value, size]);
  return <div role="img" aria-label="QR code" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
