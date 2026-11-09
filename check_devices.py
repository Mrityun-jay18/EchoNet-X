import subprocess
import json

cmd = "Get-PnpDevice | Where-Object { $_.ConfigManagerErrorCode -ne 0 -or $_.Class -eq 'Ports' -or $_.Class -eq 'USB' } | Select-Object FriendlyName, Status, Class, ConfigManagerErrorCode, InstanceId | ConvertTo-Json"

res = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True)
print("=== DEVICE MANAGER DIAGNOSTICS ===")
print(res.stdout)
