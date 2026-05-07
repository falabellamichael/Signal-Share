# Audit script to find duplicate function/variable declarations in JS files
$files = @("hero-media-player.js", "hero-media-player-preview.js", "app-v3-ui.js")

foreach ($file in $files) {
    Write-Host "--- Auditing $file ---"
    $content = Get-Content $file
    
    # Extract function names
    $functions = $content | Select-String -Pattern 'function\s+(\w+)' | ForEach-Object { $_.Matches.Groups[1].Value }
    $duplicates = $functions | Group-Object | Where-Object { $_.Count -gt 1 }
    if ($duplicates) {
        Write-Host "Duplicate Functions in $file`:"
        $duplicates | Select-Object -Property Name, Count | Format-Table
    } else {
        Write-Host "No duplicate functions found in $file."
    }

    # Extract variable declarations (let/const) - simple check
    $vars = $content | Select-String -Pattern '\b(let|const)\s+(\w+)' | ForEach-Object { $_.Matches.Groups[2].Value }
    $dupVars = $vars | Group-Object | Where-Object { $_.Count -gt 1 }
    if ($dupVars) {
        Write-Host "Duplicate Variables in $file`:"
        $dupVars | Select-Object -Property Name, Count | Format-Table
    }
}
