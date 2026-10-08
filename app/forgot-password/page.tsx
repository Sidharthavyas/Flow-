import PasswordResetForm from "@/components/PasswordResetForm";
import { emailResetEnabled } from "@/lib/admin";
import { mailEnabled } from "@/lib/mail";

export const dynamic = "force-dynamic";
export default function ForgotPasswordPage() {
  return <PasswordResetForm mode="request" emailEnabled={emailResetEnabled() && mailEnabled()} />;
}
