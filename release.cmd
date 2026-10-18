@echo off
rem One-command release: bump version, commit, tag, push (CI builds the Release)
rem Usage: release.cmd patch ^| minor ^| major  [--dry-run]
setlocal
cd /d "%~dp0"
node release.mjs %*
pause
