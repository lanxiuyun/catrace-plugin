$ErrorActionPreference = 'Continue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DotaTw {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

function Invoke-Cycle {
  for ($vk = 0x41; $vk -le 0x5A; $vk++) {
    [DotaTw]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    [DotaTw]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  switch ($line.Trim()) {
    'CYCLE' { Invoke-Cycle }
    'QUIT' { return }
  }
}
