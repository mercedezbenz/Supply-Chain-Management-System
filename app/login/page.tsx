"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // Track if we've confirmed the user is unauthenticated so we can avoid any flash
  const [showLogin, setShowLogin] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
    // Once auth resolves and no user, allow login form to show
    if (!loading && !user) {
      setShowLogin(true);
    }
  }, [user, loading, router]);

  // CRITICAL FIX: Login page should NEVER show a skeleton loader.
  // Show the login form immediately. If auth is still loading, show the form anyway
  // (it handles its own submit states). Only show a brief spinner if auth is
  // initializing AND we haven't confirmed the state yet.
  
  // If user is authenticated, show redirecting state
  if (!loading && user) {
    return (
      <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-2" />
        <p className="text-gray-500">Redirecting to dashboard...</p>
      </div>
    );
  }

  // Show login form immediately — no skeleton, no loading UI
  // The login form itself is lightweight and renders instantly
  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center">
      <LoginForm />
    </div>
  );
}
