"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Cloud, LogIn, LogOut, Loader2, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import {
    initGoogleDriveClient,
    signInToGoogle,
    signOutFromGoogle,
    onAuthStateChange,
    type GoogleUserProfile,
} from "@/lib/google-drive-service"

interface GoogleDriveButtonProps {
    variant?: "default" | "outline" | "ghost" | "secondary"
    size?: "default" | "sm" | "lg" | "icon"
    showDropdown?: boolean
    className?: string
    onAuthChange?: (isAuthenticated: boolean, profile: GoogleUserProfile | null) => void
}

export function GoogleDriveButton({
    variant = "outline",
    size = "default",
    showDropdown = true,
    className = "",
    onAuthChange,
}: GoogleDriveButtonProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null)
    const [isInitializing, setIsInitializing] = useState(true)
    const [isSigningIn, setIsSigningIn] = useState(false)

    // Initialize and subscribe to auth state
    useEffect(() => {
        let unsubscribe: (() => void) | undefined

        const init = async () => {
            try {
                await initGoogleDriveClient()
                unsubscribe = onAuthStateChange((auth, profile) => {
                    setIsAuthenticated(auth)
                    setUserProfile(profile)
                    onAuthChange?.(auth, profile)
                })
            } catch (error) {
                console.error("[GoogleDriveButton] Failed to initialize:", error)
            } finally {
                setIsInitializing(false)
            }
        }

        init()

        return () => {
            unsubscribe?.()
        }
    }, [onAuthChange])

    // Handle sign in
    const handleSignIn = async () => {
        setIsSigningIn(true)
        try {
            await signInToGoogle()
            toast.success("Connected to Google Drive", {
                description: "You can now upload files to your Google Drive",
            })
        } catch (error: any) {
            toast.error("Connection failed", {
                description: error.message || "Please try again",
            })
        } finally {
            setIsSigningIn(false)
        }
    }

    // Handle sign out
    const handleSignOut = () => {
        signOutFromGoogle()
        toast.info("Disconnected from Google Drive")
    }

    // Loading state
    if (isInitializing) {
        return (
            <Button variant={variant} size={size} disabled className={className}>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Initializing...
            </Button>
        )
    }

    // Not authenticated - show sign in button
    if (!isAuthenticated) {
        return (
            <Button
                variant={variant}
                size={size}
                onClick={handleSignIn}
                disabled={isSigningIn}
                className={`gap-2 ${className}`}
            >
                {isSigningIn ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                    </>
                ) : (
                    <>
                        <Cloud className="h-4 w-4" />
                        Connect Google Drive
                    </>
                )}
            </Button>
        )
    }

    // Authenticated with dropdown
    if (showDropdown) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant={variant} size={size} className={`gap-2 ${className}`}>
                        {userProfile?.imageUrl ? (
                            <Avatar className="h-5 w-5">
                                <AvatarImage src={userProfile.imageUrl} alt={userProfile.name} />
                                <AvatarFallback className="text-xs">
                                    {userProfile.name?.charAt(0) || "G"}
                                </AvatarFallback>
                            </Avatar>
                        ) : (
                            <Cloud className="h-4 w-4 text-green-500" />
                        )}
                        <span className="max-w-[120px] truncate">{userProfile?.name || "Connected"}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium">{userProfile?.name}</p>
                            <p className="text-xs text-muted-foreground">{userProfile?.email}</p>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                        <LogOut className="h-4 w-4 mr-2" />
                        Disconnect
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }

    // Authenticated without dropdown - simple button
    return (
        <Button variant={variant} size={size} onClick={handleSignOut} className={`gap-2 ${className}`}>
            <Cloud className="h-4 w-4 text-green-500" />
            <span className="max-w-[120px] truncate">{userProfile?.name || "Connected"}</span>
        </Button>
    )
}
