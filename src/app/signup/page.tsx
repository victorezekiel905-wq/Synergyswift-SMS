import { redirect } from "next/navigation";

/** Schools now start at /onboard with a one-time code; students sign up at /student/join. */
export default function SignupPage() {
  redirect("/onboard");
}
