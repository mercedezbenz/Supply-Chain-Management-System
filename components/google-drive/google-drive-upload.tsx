"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import {
    Upload,
    Cloud,
    CheckCircle2,
    AlertCircle,
    Loader2,
    X,
    Image as ImageIcon,
    LogIn,
    LogOut,
} from "lucide-react"
import { toast } from "sonner"
import {
    initGoogleDriveClient,
    signInToGoogle,
    signOutFromGoogle,
    isGoogleAuthenticated,
    getGoogleUserProfile,
    uploadFileToGoogleDrive,
    onAuthStateChange,
    type GoogleUserProfile,
    type GoogleDriveUploadResult,
} from "@/lib/google-drive-service"

interface GoogleDriveUploadProps {
    onUploadComplete: (url: string, fileId: string) => void
    onError?: (error: Error) => void
    accept?: string
    maxSizeMB?: number
    folderName?: string
    buttonText?: string
    showPreview?: boolean
    className?: string
}

export function GoogleDriveUpload({
    onUploadComplete,
    onError,
    accept = "image/*",
    maxSizeMB = 10,
    folderName = "DecktaGO Uploads",
    buttonText = "Upload to Google Drive",
    showPreview = true,
    className = "",
}: GoogleDriveUploadProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null)
    const [isInitializing, setIsInitializing] = useState(true)
    const [isSigningIn, setIsSigningIn] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle")
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Initialize Google Drive client
    useEffect(() => {
        let unsubscribe: (() => void) | undefined

        const init = async () => {
            try {
                await initGoogleDriveClient()
                // Subscribe to auth state changes
                unsubscribe = onAuthStateChange((auth, profile) => {
                    setIsAuthenticated(auth)
                    setUserProfile(profile)
                })
            } catch (error) {
                console.error("[GoogleDriveUpload] Failed to initialize:", error)
            } finally {
                setIsInitializing(false)
            }
        }

        init()

        return () => {
            unsubscribe?.()
        }
    }, [])

    // Handle file selection
    const handleFileSelect = useCallback(
        (file: File) => {
            // Validate file type
            const acceptedTypes = accept.split(",").map((t) => t.trim())
            const isValidType = acceptedTypes.some((type) => {
                if (type === "image/*") return file.type.startsWith("image/")
                if (type === "video/*") return file.type.startsWith("video/")
                return file.type === type || file.name.endsWith(type)
            })

            if (!isValidType) {
                toast.error("Invalid file type", {
                    description: `Please select a file matching: ${accept}`,
                })
                return
            }

            // Validate file size
            const maxBytes = maxSizeMB * 1024 * 1024
            if (file.size > maxBytes) {
                toast.error("File too large", {
                    description: `Maximum file size is ${maxSizeMB}MB`,
                })
                return
            }

            setSelectedFile(file)
            setUploadStatus("idle")

            // Create preview for images
            if (showPreview && file.type.startsWith("image/")) {
                setPreviewUrl(URL.createObjectURL(file))
            }

            toast.success("File selected", {
                description: `${file.name} ready to upload`,
            })
        },
        [accept, maxSizeMB, showPreview]
    )

    // Handle file input change
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            handleFileSelect(file)
        }
    }

    // Handle drag events
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) {
            handleFileSelect(file)
        }
    }

    // Handle sign in
    const handleSignIn = async () => {
        setIsSigningIn(true)
        try {
            await signInToGoogle()
            toast.success("Connected to Google Drive", {
                description: "You can now upload files to your Google Drive",
            })
        } catch (error: any) {
            toast.error("Failed to connect", {
                description: error.message || "Please try again",
            })
            onError?.(error)
        } finally {
            setIsSigningIn(false)
        }
    }

    // Handle sign out
    const handleSignOut = () => {
        signOutFromGoogle()
        setSelectedFile(null)
        setPreviewUrl(null)
        setUploadStatus("idle")
        toast.info("Disconnected from Google Drive")
    }

    // Handle upload
    const handleUpload = async () => {
        if (!selectedFile) {
            toast.error("No file selected", {
                description: "Please select a file first",
            })
            return
        }

        if (!isAuthenticated) {
            toast.error("Not connected", {
                description: "Please connect to Google Drive first",
            })
            return
        }

        setIsUploading(true)
        setUploadStatus("uploading")
        setUploadProgress(0)

        try {
            const result: GoogleDriveUploadResult = await uploadFileToGoogleDrive(
                selectedFile,
                folderName,
                (progress) => setUploadProgress(progress)
            )

            if (result.success) {
                setUploadStatus("success")
                toast.success("Upload complete!", {
                    description: "Your file has been uploaded to Google Drive",
                })
                onUploadComplete(result.webViewLink, result.fileId)
            } else {
                throw new Error(result.error || "Upload failed")
            }
        } catch (error: any) {
            setUploadStatus("error")
            toast.error("Upload failed", {
                description: error.message || "Please try again",
            })
            onError?.(error)
        } finally {
            setIsUploading(false)
        }
    }

    // Clear selection
    const clearSelection = () => {
        setSelectedFile(null)
        setPreviewUrl(null)
        setUploadStatus("idle")
        setUploadProgress(0)
        if (fileInputRef.current) {
            fileInputRef.current.value = ""
        }
    }

    // Loading state
    if (isInitializing) {
        return (
            <Card className={`border-dashed ${className}`}>
                <CardContent className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Initializing Google Drive...</span>
                </CardContent>
            </Card>
        )
    }

    // Not authenticated state
    if (!isAuthenticated) {
        return (
            <Card className={`border-dashed ${className}`}>
                <CardContent className="py-8">
                    <div className="flex flex-col items-center gap-4 text-center">
                        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                            <Cloud className="h-7 w-7 text-primary" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg">Connect to Google Drive</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                Sign in with your Google account to upload files
                            </p>
                        </div>
                        <Button onClick={handleSignIn} disabled={isSigningIn} className="gap-2">
                            {isSigningIn ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    <LogIn className="h-4 w-4" />
                                    Connect to Google Drive
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )
    }

    // Authenticated state
    return (
        <Card className={`overflow-hidden ${className}`}>
            <CardContent className="p-4 space-y-4">
                {/* User info header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {userProfile?.imageUrl ? (
                            <img
                                src={userProfile.imageUrl}
                                alt={userProfile.name}
                                className="h-8 w-8 rounded-full"
                            />
                        ) : (
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <Cloud className="h-4 w-4 text-primary" />
                            </div>
                        )}
                        <div className="text-sm">
                            <p className="font-medium">{userProfile?.name || "Connected"}</p>
                            <p className="text-muted-foreground text-xs">{userProfile?.email}</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1 text-xs">
                        <LogOut className="h-3 w-3" />
                        Disconnect
                    </Button>
                </div>

                {/* Drop zone */}
                <div
                    className={`
            relative border-2 border-dashed rounded-lg transition-all duration-200
            ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"}
            ${selectedFile ? "py-4" : "py-8"}
          `}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Preview */}
                    {showPreview && previewUrl && (
                        <div className="relative mb-4 flex justify-center">
                            <div className="relative">
                                <img
                                    src={previewUrl}
                                    alt="Preview"
                                    className="max-h-32 rounded-lg object-contain"
                                />
                                <button
                                    type="button"
                                    onClick={clearSelection}
                                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/90"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* File info or drop prompt */}
                    <div className="flex flex-col items-center gap-3 text-center px-4">
                        {selectedFile ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                    <span className="font-medium truncate max-w-[200px]">{selectedFile.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                                    </span>
                                </div>

                                {/* Upload progress */}
                                {uploadStatus === "uploading" && (
                                    <div className="w-full max-w-xs space-y-1">
                                        <Progress value={uploadProgress} className="h-2" />
                                        <p className="text-xs text-muted-foreground">Uploading... {uploadProgress}%</p>
                                    </div>
                                )}

                                {/* Status indicators */}
                                {uploadStatus === "success" && (
                                    <div className="flex items-center gap-1 text-green-600">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span className="text-sm">Uploaded successfully!</span>
                                    </div>
                                )}

                                {uploadStatus === "error" && (
                                    <div className="flex items-center gap-1 text-destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <span className="text-sm">Upload failed</span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Upload className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="font-medium">Drop your file here</p>
                                    <p className="text-sm text-muted-foreground">or click to browse</p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={accept}
                        onChange={handleFileInputChange}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        disabled={isUploading}
                    />
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                    <Button
                        onClick={() => fileInputRef.current?.click()}
                        variant="outline"
                        className="flex-1 gap-2"
                        disabled={isUploading}
                    >
                        <Upload className="h-4 w-4" />
                        {selectedFile ? "Change File" : "Select File"}
                    </Button>
                    <Button
                        onClick={handleUpload}
                        disabled={!selectedFile || isUploading || uploadStatus === "success"}
                        className="flex-1 gap-2"
                    >
                        {isUploading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Uploading...
                            </>
                        ) : uploadStatus === "success" ? (
                            <>
                                <CheckCircle2 className="h-4 w-4" />
                                Uploaded
                            </>
                        ) : (
                            <>
                                <Cloud className="h-4 w-4" />
                                {buttonText}
                            </>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
