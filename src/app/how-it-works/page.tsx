import { redirect } from "next/navigation";

/** The tour moved to /tour. */
export default function HowItWorks() {
  redirect("/tour");
}
