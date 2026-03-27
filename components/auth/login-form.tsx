"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Clock, User, Eye, EyeOff, UserCircle } from "lucide-react";
import Image from "next/image";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  const { signIn, loginAsGuest, firebaseError } = useAuth();
  const router = useRouter();

  // Keep firebaseError wired into our generic error alert
  useEffect(() => {
    if (firebaseError) {
      setError(firebaseError);
    }
  }, [firebaseError]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (rateLimitCountdown > 0) {
      interval = setInterval(() => {
        setRateLimitCountdown((prev) => {
          if (prev <= 1) {
            setIsRateLimited(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [rateLimitCountdown]);

  const handleFirebaseError = (error: any) => {
    const errorCode = error.code || error.message;

    if (errorCode.includes("too-many-requests")) {
      setIsRateLimited(true);
      setRateLimitCountdown(300); // 5 minutes
      setError(
        "Too many failed attempts. Please wait 5 minutes before trying again, or try from a different device/network."
      );
    } else if (
      errorCode.includes("wrong-password") ||
      errorCode.includes("invalid-credential")
    ) {
      setError(
        "Invalid email or password. Default credentials: admin@decktago.com / admin123"
      );
    } else if (errorCode.includes("invalid-email")) {
      setError("Please enter a valid email address.");
    } else {
      setError(error.message || "Failed to sign in");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      console.log("[Login] Attempting login with:", email);
      await signIn(email, password);
      console.log("[Login] Login successful, redirecting...");
      router.replace("/");
    } catch (error: any) {
      console.error("[Login] Login error:", error);
      handleFirebaseError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = () => {
    console.log("[Login] Guest login button clicked");
    loginAsGuest();
    // Use setTimeout to ensure state is updated before navigating
    setTimeout(() => {
      console.log("[Login] Redirecting to dashboard after guest login...");
      router.push("/");
    }, 100);
  };

  const renderError = () => {
    if (!error) return null;

    const isRateLimitError =
      error.includes("too-many-requests") || error.includes("wait");

    return (
      <Alert variant="destructive">
        {isRateLimitError && <Clock className="h-4 w-4" />}
        {!isRateLimitError && <AlertTriangle className="h-4 w-4" />}
        <AlertDescription>
          {error}
          {isRateLimited && rateLimitCountdown > 0 && (
            <div className="mt-2 text-sm">
              <strong>
                Time remaining: {Math.floor(rateLimitCountdown / 60)}:
                {(rateLimitCountdown % 60).toString().padStart(2, "0")}
              </strong>
            </div>
          )}
          {isRateLimitError && (
            <div className="mt-2 text-sm">
              <strong>Quick fixes:</strong>
              <ul className="list-disc list-inside mt-1">
                <li>Wait 15-30 minutes</li>
                <li>Try from a different device/network</li>
                <li>Clear browser cache and cookies</li>
              </ul>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  };

  // ---------- LOGIN VIEW ----------
  return (
    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-4xl w-full mx-4 flex">
      {/* Left side - Branding */}
      <div className="hidden md:flex md:w-1/2 bg-gray-50 p-12 flex-col justify-center items-center">
        <div className="text-center">
          <div className="mx-auto mb-6 w-[120px] h-[120px] flex items-center justify-center relative">
            <Image
              src="/logo.png"
              alt="DPE Logo"
              width={120}
              height={120}
              className="object-contain"
              priority
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Deckta<span className="text-sky-500">GO</span>
          </h1>
          <p className="text-xl text-gray-600">Admin</p>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="w-full md:w-1/2 bg-sky-500 p-12 flex flex-col justify-center relative">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-400/20 to-sky-600/20"></div>
        <div className="w-full max-w-sm mx-auto relative z-10">
          <h2 className="text-2xl font-semibold text-white mb-8 text-center">
            Admin Login
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
            {renderError()}

            <div className="relative">
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || isRateLimited}
                autoComplete="off"
                className="w-full px-4 py-3 pr-12 rounded-full border-0 bg-white/90 backdrop-blur-sm text-gray-900 placeholder-gray-500 focus:bg-white focus:ring-2 focus:ring-white/50"
              />
              <User className="absolute right-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            </div>

            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading || isRateLimited}
                autoComplete="new-password"
                className="w-full px-4 py-3 pr-12 rounded-full border-0 bg-white/90 backdrop-blur-sm text-gray-900 placeholder-gray-500 focus:bg-white focus:ring-2 focus:ring-white/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>

            <Button
              type="submit"
              className="w-full py-3 rounded-full bg-white text-sky-600 font-semibold hover:bg-gray-50 focus:ring-2 focus:ring-white/50 transition-all duration-200"
              disabled={loading || isRateLimited}
            >
              {loading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isRateLimited && <Clock className="mr-2 h-4 w-4" />}
              {isRateLimited
                ? `Wait ${Math.floor(rateLimitCountdown / 60)}:${(
                    rateLimitCountdown % 60
                  )
                    .toString()
                    .padStart(2, "0")}`
                : "LOGIN"}
            </Button>

            <div className="pt-4">
              <Button
                type="button"
                variant="ghost"
                className="w-full text-white text-sm rounded-full border border-white/20 hover:bg-white/10 hover:border-white/30 transition-all gap-2"
                onClick={handleGuestLogin}
                disabled={loading || isRateLimited}
              >
                <UserCircle className="h-4 w-4" />
                Login as Guest
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
