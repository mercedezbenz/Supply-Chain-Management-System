"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Printer, Download, CheckCircle2, X } from "lucide-react"

interface BarcodeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  barcode: string
  productName: string
}

export function BarcodeModal({ open, onOpenChange, barcode, productName }: BarcodeModalProps) {
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null)
  const [svgMounted, setSvgMounted] = useState(false)

  // Callback ref: fires the instant the <svg> enters the DOM
  const svgCallbackRef = useCallback((node: SVGSVGElement | null) => {
    barcodeSvgRef.current = node
    setSvgMounted(!!node)
  }, [])

  // Render barcode using JsBarcode when SVG is mounted and barcode value is available
  useEffect(() => {
    if (!svgMounted || !barcodeSvgRef.current || !barcode) return
    import("jsbarcode").then((mod) => {
      const JsBarcode = mod.default || mod
      try {
        JsBarcode(barcodeSvgRef.current!, barcode, {
          format: "CODE128",
          width: 2.5,
          height: 100,
          displayValue: true,
          fontSize: 16,
          fontOptions: "bold",
          margin: 12,
          background: "#ffffff",
          lineColor: "#000000",
        })
      } catch (err) {
        console.error("[BarcodeModal] JsBarcode render error:", err)
      }
    })
  }, [svgMounted, barcode])

  // ── Print handler (hidden iframe — clean print layout) ─────────────────
  const handlePrint = useCallback(() => {
    const svgEl = barcodeSvgRef.current
    if (!svgEl) return
    const svgHtml = svgEl.outerHTML

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.top = "-10000px"
    iframe.style.left = "-10000px"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "none"
    document.body.appendChild(iframe)

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      document.body.removeChild(iframe)
      return
    }

    iframeDoc.open()
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Barcode — ${barcode}</title>
          <style>
            body {
              margin: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              background: white;
              font-family: Arial, Helvetica, sans-serif;
            }
            .label-container {
              text-align: center;
              padding: 20px;
            }
            .product-name {
              font-size: 14pt;
              font-weight: bold;
              margin-bottom: 4px;
            }
            .barcode-code {
              font-size: 10pt;
              font-family: monospace;
              letter-spacing: 2px;
              color: #555;
              margin-bottom: 12px;
            }
            svg { max-width: 95%; }
          </style>
        </head>
        <body>
          <div class="label-container">
            <div class="product-name">${productName}</div>
            <div class="barcode-code">${barcode}</div>
            ${svgHtml}
          </div>
        </body>
      </html>
    `)
    iframeDoc.close()

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        setTimeout(() => { document.body.removeChild(iframe) }, 1000)
      }, 250)
    }

    setTimeout(() => {
      if (document.body.contains(iframe)) {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        setTimeout(() => {
          if (document.body.contains(iframe)) document.body.removeChild(iframe)
        }, 1000)
      }
    }, 500)
  }, [barcode, productName])

  // ── Download as PNG ──────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const svgEl = barcodeSvgRef.current
    if (!svgEl) return

    const svgData = new XMLSerializer().serializeToString(svgEl)
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      const scale = 2 // retina quality
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.scale(scale, scale)
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)

      canvas.toBlob((blob) => {
        if (!blob) return
        const downloadUrl = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = downloadUrl
        a.download = `barcode-${barcode}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(downloadUrl)
      }, "image/png")
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [barcode])

  if (!barcode) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[95vw] sm:!w-auto sm:max-w-[480px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-3 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4">
          <DialogTitle className="text-base sm:text-lg font-semibold">Barcode Preview</DialogTitle>
        </DialogHeader>

        <div className="px-3 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-5">
          {/* Barcode value field with status badge */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground">
                Barcode <span className="text-red-500">*</span>
              </label>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800">
                <CheckCircle2 className="h-3 w-3" />
                Unique & Ready
              </span>
            </div>
            <div className="flex items-center h-10 w-full rounded-lg border border-green-300 bg-green-50/50 dark:bg-green-950/20 dark:border-green-800 px-3 text-sm font-mono tracking-wide text-foreground">
              {barcode}
            </div>
          </div>

          {/* Barcode Preview Card */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              Barcode Preview <span className="text-muted-foreground text-xs font-normal">(CODE128)</span>
            </p>
            <div className="rounded-xl border-2 border-dashed border-green-300 dark:border-green-700 bg-white dark:bg-gray-950 p-4 flex flex-col items-center justify-center">
              {/* Product name above barcode */}
              <p className="text-sm font-semibold text-foreground mb-2 text-center line-clamp-2">{productName}</p>
              <svg ref={svgCallbackRef} className="w-full max-w-[380px]" />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-1">
            <Button
              onClick={handlePrint}
              data-barcode-print
              className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Printer className="h-4 w-4" />
              Print Barcode
            </Button>
            <Button
              onClick={handleDownload}
              variant="outline"
              className="flex-1 gap-2"
            >
              <Download className="h-4 w-4" />
              Download PNG
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
