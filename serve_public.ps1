$port = 8080
$root = (Get-Item .).FullName

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Server running at http://localhost:$port/"

try {
    while ($listener.IsListening) {
        $context = $null
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response
            
            Write-Host "Request: $($request.Url.LocalPath)"
            $localPath = $request.Url.LocalPath
            if ($localPath -eq "/") { $localPath = "/index.html" }
            
            $filePath = Join-Path $root $localPath.Replace('/', '\')
            
            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                switch ($ext) {
                    ".js"   { $response.ContentType = "application/javascript" }
                    ".css"  { $response.ContentType = "text/css" }
                    ".html" { $response.ContentType = "text/html; charset=utf-8" }
                    ".json" { $response.ContentType = "application/json" }
                    default { $response.ContentType = "application/octet-stream" }
                }
                
                $content = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $content.Length
                $response.OutputStream.Write($content, 0, $content.Length)
                Write-Host "-> 200 OK"
            } else {
                $response.StatusCode = 404
                Write-Host "-> 404 Not Found"
            }
            $response.Close()
        } catch {
            if ($context -and $context.Response) {
                try { $context.Response.Abort() } catch {}
            }
        }
    }
} finally {
    try { $listener.Stop() } catch {}
}
