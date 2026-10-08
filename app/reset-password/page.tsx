import PasswordResetForm from "@/components/PasswordResetForm";

export const dynamic = "force-dynamic";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <PasswordResetForm mode="reset" token={typeof token === "string" ? token : ""} />;
}
