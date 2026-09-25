"use client";

export default function PrintButton() {
  return <button className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>;
}
