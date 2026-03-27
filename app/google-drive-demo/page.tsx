"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { GoogleDriveUpload } from "@/components/google-drive/google-drive-upload"
import { GoogleDriveButton } from "@/components/google-drive/google-drive-button"
import { saveGoogleDriveUrlToUser } from "@/lib/google-drive-firebase"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"
import { ExternalLink, CloudUpload, Info } from "lucide-react"

export default function GoogleDriveDemoPage() {
    const { user } = useAuth()
    const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
    const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)

    const handleUploadComplete = async (url: string, fileId: string) => {
        setUploadedUrl(url)
        setUploadedFileId(fileId)

        // Save to Firebase if user is logged in
        if (user?.uid) {
            try {
                await saveGoogleDriveUrlToUser(user.uid, url, "googleDrivePhotoUrl")
                toast.success("URL saved to Firebase", {
                    description: "The Google Drive URL has been saved to your user profile.",
                })
            } catch (error: any) {
                toast.error("Failed to save to Firebase", {
                    description: error.message,
                })
            }
        }
    }

    return (
        <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
            {/* Header */}
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Google Drive Integration</h1>
                <p className="text-muted-foreground">
                    Upload files to Google Drive and save the URL to Firebase
                </p>
            </div>

            {/* Info Card */}
            <Card className="border-blue-500/20 bg-blue-500/5">
                <CardContent className="flex gap-3 py-4">
                    <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-blue-600 dark:text-blue-400">How it works</p>
                        <ol className="list-decimal list-inside mt-1 space-y-1 text-muted-foreground">
                            <li>Connect to Google Drive using OAuth 2.0</li>
                            <li>Select a file to upload</li>
                            <li>The file is uploaded to your Google Drive</li>
                            <li>The file URL is saved to Firebase Firestore</li>
                        </ol>
                    </div>
                </CardContent>
            </Card>

            {/* Connection Status */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Google Drive Connection</CardTitle>
                    <CardDescription>Connect your Google account to enable uploads</CardDescription>
                </CardHeader>
                <CardContent>
                    <GoogleDriveButton />
                </CardContent>
            </Card>

            {/* Upload Component */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <CloudUpload className="h-5 w-5" />
                        Upload to Google Drive
                    </CardTitle>
                    <CardDescription>
                        Upload a photo and the URL will be saved to your Firebase profile
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <GoogleDriveUpload
                        onUploadComplete={handleUploadComplete}
                        onError={(error) => console.error("Upload error:", error)}
                        accept="image/*"
                        maxSizeMB={10}
                        folderName="DecktaGO Uploads"
                        buttonText="Upload"
                    />
                </CardContent>
            </Card>

            {/* Result */}
            {uploadedUrl && (
                <Card className="border-green-500/20 bg-green-500/5">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg text-green-600 dark:text-green-400">
                            Upload Successful!
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1">
                            <p className="text-sm font-medium">File ID</p>
                            <code className="text-xs bg-muted px-2 py-1 rounded block overflow-x-auto">
                                {uploadedFileId}
                            </code>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium">Google Drive URL</p>
                            <a
                                href={uploadedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-primary hover:underline flex items-center gap-1"
                            >
                                {uploadedUrl}
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                        {user && (
                            <p className="text-sm text-muted-foreground">
                                ✓ URL saved to Firebase user profile ({user.email})
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
