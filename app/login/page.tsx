"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Prevent redirect loop
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center">
        <LoginForm />
      </div>
    );
  }

  // If we are authenticated, show a simple redirecting state as a fallback
  // instead of null while the useEffect is doing router.replace("/")
  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-2" />
      <p className="text-gray-500">Redirecting to dashboard...</p>
    </div>
  );
}

