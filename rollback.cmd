@echo off
REM 回滚 dsh-ops-conventions：删除插件目录 + 恢复 package.json 备份
setlocal
set PROF=C:\Users\TANG\.dsh\profiles\desktop
set BK=C:\Users\TANG\.dsh\_backups\profile-20261018-opsconv

echo [1/3] 还原 package.json
if exist "%BK%\package.json" copy /Y "%BK%\package.json" "%PROF%\package.json"

echo [2/3] 还原 cordis.patch.yml
if exist "%BK%\cordis.patch.yml" copy /Y "%BK%\cordis.patch.yml" "%PROF%\cordis.patch.yml"

echo [3/3] 删除插件目录
if exist "%PROF%\node_modules\dsh-ops-conventions" rmdir /S /Q "%PROF%\node_modules\dsh-ops-conventions"

echo.
echo 已回滚。请重启 DeepSeek Harness。
pause
